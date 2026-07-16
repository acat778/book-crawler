import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from './prisma.js'
import { getMongoDb } from './mongo-client.js'
import { uploadObject } from './s3-client.js'
import config from '../config.js'

const CRAWLER_USER_ID = String(config.crawler.userId || '0')
const COVER_FILE_ID = '0'

function nowId() {
  return uuidv4()
}

function dictCode(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '_').replace(/_+/g, '_')
}

function splitParagraphs(content) {
  return String(content || '').split('\n\n').map((part) => part.trim()).filter(Boolean)
}

function wordCount(content) {
  return String(content || '').replace(/\s/g, '').length
}

function extensionFromContentType(contentType) {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('avif')) return 'avif'
  return 'jpg'
}

async function getDict(dictCodeValue, dictName) {
  const existing = await prisma.acatDict.findFirst({
    where: { code: dictCodeValue, scope: 1, isDeleted: 0 },
  })
  if (existing) return existing
  return prisma.acatDict.create({
    data: {
      id: nowId(),
      code: dictCodeValue,
      name: dictName,
      scope: 1,
      isEnabled: 1,
      isTree: 0,
      createBy: CRAWLER_USER_ID,
      updateBy: CRAWLER_USER_ID,
    },
  })
}

async function findOrCreateDictData(dictCodeValue, dictName, name) {
  const dict = await getDict(dictCodeValue, dictName)
  const existing = await prisma.acatDictData.findFirst({
    where: { dictId: dict.id, name, isDeleted: 0 },
  })
  if (existing) return existing
  const code = dictCode(name)
  return prisma.acatDictData.create({
    data: {
      id: nowId(),
      dictId: dict.id,
      code,
      name,
      value: code,
      sortOrder: 0,
      isEnabled: 1,
      createBy: CRAWLER_USER_ID,
      updateBy: CRAWLER_USER_ID,
    },
  })
}

async function syncBookToMongo(book) {
  const db = await getMongoDb()
  const doc = {
    _id: book.id,
    title: book.title,
    author_id: book.authorId,
    category: book.category,
    description: book.description || '',
    status: book.status,
    is_adult: book.isAdult,
    i18n_code: 'zh-CN',
    is_deleted: book.isDeleted || 0,
    update_by: CRAWLER_USER_ID,
    updated_at: new Date(),
    version: book.version || 0,
  }
  await db.collection('books').updateOne(
    { _id: book.id },
    {
      $setOnInsert: {
        created_at: new Date(),
        create_by: CRAWLER_USER_ID,
      },
      $set: doc,
    },
    { upsert: true },
  )
}

export async function syncChapterDocument({
  db,
  bookId,
  chapter,
  content,
  replace = true,
  idFactory = nowId,
  clock = () => new Date(),
}) {
  const now = clock()
  const paragraphs = splitParagraphs(content).map((part) => ({
    _id: idFactory(),
    content: part,
    is_deleted: 0,
    create_by: CRAWLER_USER_ID,
    update_by: CRAWLER_USER_ID,
    created_at: now,
    updated_at: now,
    version: 0,
  }))

  // 写入独立 chapters 集合 — 不再嵌入 books 集合，
  // 避免单本书文档超过 MongoDB 16MB BSON 限制
  const update = {
    $setOnInsert: {
      create_by: CRAWLER_USER_ID,
      created_at: now,
      version: 0,
    },
    $set: {
      book_id: bookId,
      title: chapter.title,
      sort_order: chapter.sortOrder,
      is_deleted: 0,
      update_by: CRAWLER_USER_ID,
      updated_at: now,
    },
  }
  if (replace) {
    update.$set.word_count = chapter.wordCount
    update.$set.paragraphs = paragraphs
  } else {
    update.$inc = { word_count: wordCount(content) }
    update.$push = { paragraphs: { $each: paragraphs } }
  }

  await db.collection('chapters').updateOne(
    { _id: chapter.id },
    update,
    { upsert: true },
  )

  // 在 book_id 上建索引（首次调用时）
  try {
    await db.collection('chapters').createIndex({ book_id: 1 }, { background: true })
  } catch (_) { /* 索引已存在 */ }

  return paragraphs.length
}

async function syncChapterToMongo(args) {
  const db = await getMongoDb()
  return syncChapterDocument({ db, ...args })
}

async function updateBookStats(bookId) {
  const chapters = await prisma.readBookChapter.findMany({ where: { bookId, isDeleted: 0 } })
  await prisma.readBook.update({
    where: { id: bookId },
    data: {
      chapterCount: chapters.length,
      wordCount: BigInt(chapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0)),
      updateBy: CRAWLER_USER_ID,
    },
  })
}

export const bookRepository = {
  async findOrCreateAuthor(name) {
    const normalized = name?.trim() || '佚名'
    const existing = await prisma.readBookAuthor.findFirst({ where: { name: normalized, isDeleted: 0 } })
    if (existing) return existing.id
    const created = await prisma.readBookAuthor.create({
      data: {
        id: nowId(),
        name: normalized,
        description: '',
        status: 1,
        createBy: CRAWLER_USER_ID,
        updateBy: CRAWLER_USER_ID,
      },
    })
    return created.id
  },

  async findOrCreateCategory(name) {
    if (!name?.trim()) return null
    const item = await findOrCreateDictData('book_category', '书籍分类', name.trim())
    return item.id
  },

  async findOrCreateTags(names) {
    const result = []
    for (const name of names || []) {
      if (!name?.trim()) continue
      const item = await findOrCreateDictData('book_tag', '书籍标签', name.trim())
      result.push({ tag: item.name, id: item.id })
    }
    return result
  },

  async findExistingBook(title, authorName) {
    const author = await prisma.readBookAuthor.findFirst({ where: { name: authorName, isDeleted: 0 } })
    if (!author) return null
    const book = await prisma.readBook.findFirst({ where: { title, authorId: author.id, isDeleted: 0 } })
    return book ? { id: book.id, title: book.title, authorId: book.authorId } : null
  },

  async createBook(bookData) {
    const existing = await prisma.readBook.findFirst({
      where: { title: bookData.title, authorId: bookData.authorId, isDeleted: 0 },
    })
    if (existing) return { id: existing.id, title: existing.title }

    const book = await prisma.readBook.create({
      data: {
        id: nowId(),
        title: bookData.title,
        authorId: bookData.authorId,
        coverId: bookData.coverId && bookData.coverId !== COVER_FILE_ID ? bookData.coverId : null,
        description: bookData.description || '',
        category: bookData.category || '',
        status: bookData.status ?? 0,
        isAdult: bookData.isAdult ? 1 : 0,
        reviewStatus: 1,
        frozen: 0,
        wordCount: 0,
        chapterCount: 0,
        createBy: CRAWLER_USER_ID,
        updateBy: CRAWLER_USER_ID,
      },
    })

    for (const tagId of bookData.tagIds || []) {
      await prisma.readBookTagRelation.upsert({
        where: { bookId_tagId: { bookId: book.id, tagId } },
        create: { id: nowId(), bookId: book.id, tagId, status: 0, createBy: CRAWLER_USER_ID, updateBy: CRAWLER_USER_ID },
        update: { isDeleted: 0, updateBy: CRAWLER_USER_ID },
      })
    }
    await syncBookToMongo(book)
    return { id: book.id, title: book.title }
  },

  async uploadCover(imageUrl) {
    if (!imageUrl || imageUrl.includes('nocover')) return COVER_FILE_ID
    const resp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 })
    const body = Buffer.from(resp.data)
    const contentType = resp.headers['content-type'] || 'image/jpeg'
    const fileName = `${nowId()}.${extensionFromContentType(contentType)}`
    const objectName = `acat-fun/read/book/cover/${fileName}`
    await uploadObject({ key: objectName, body, contentType })
    const file = await prisma.acatFile.create({
      data: {
        id: nowId(),
        name: fileName,
        path: `${config.storage.bucket}/${objectName}`,
        type: contentType,
        fileType: 'book_cover',
        size: BigInt(body.length),
        createBy: CRAWLER_USER_ID,
        updateBy: CRAWLER_USER_ID,
      },
    })
    return file.id
  },

  async createChapterWithContent(bookId, title, content) {
    const existing = await prisma.readBookChapter.findFirst({
      where: { bookId, title, isDeleted: 0 },
    })
    if (existing) {
      let chapter = existing
      if (content) {
        chapter = await prisma.readBookChapter.update({
          where: { id: existing.id },
          data: {
            wordCount: wordCount(content),
            status: 1,
            updateBy: CRAWLER_USER_ID,
          },
        })
        await syncChapterToMongo({ bookId, chapter, content, replace: true })
      }
      await updateBookStats(bookId)
      return { id: chapter.id, title: chapter.title, sortOrder: chapter.sortOrder }
    }

    const max = await prisma.readBookChapter.aggregate({
      where: { bookId, isDeleted: 0 },
      _max: { sortOrder: true },
    })
    const chapter = await prisma.readBookChapter.create({
      data: {
        id: nowId(),
        bookId,
        title,
        status: 1,
        sortOrder: (max._max.sortOrder || 0) + 1,
        wordCount: wordCount(content),
        createBy: CRAWLER_USER_ID,
        updateBy: CRAWLER_USER_ID,
      },
    })
    if (content) await syncChapterToMongo({ bookId, chapter, content, replace: true })
    await updateBookStats(bookId)
    return { id: chapter.id, title: chapter.title, sortOrder: chapter.sortOrder }
  },

  async appendParagraphs(chapterId, content) {
    const chapter = await prisma.readBookChapter.findFirst({ where: { id: chapterId, isDeleted: 0 } })
    if (!chapter) throw new Error(`章节不存在: ${chapterId}`)
    const appended = await syncChapterToMongo({ bookId: chapter.bookId, chapter, content, replace: false })
    await prisma.readBookChapter.update({
      where: { id: chapterId },
      data: { wordCount: (chapter.wordCount || 0) + wordCount(content), updateBy: CRAWLER_USER_ID },
    })
    await updateBookStats(chapter.bookId)
    return appended
  },

  async reportTaskStatus(bookId, status, extra = {}) {
    console.log('[BookRepository] 任务状态:', { bookId, status, ...extra })
  },
}
