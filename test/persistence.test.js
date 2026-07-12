import assert from 'node:assert/strict'
import test from 'node:test'
import { syncChapterDocument } from '../src/persistence/book-repository.js'
import { bookRepository } from '../src/persistence/book-repository.js'
import { prisma } from '../src/persistence/prisma.js'
import { StorageService } from '../src/store/storage.js'

function createMemoryMongo() {
  const documents = new Map()
  const collection = {
    async updateOne(filter, update) {
      const current = documents.get(filter._id) || { _id: filter._id, ...update.$setOnInsert }
      Object.assign(current, update.$set)
      for (const [field, increment] of Object.entries(update.$inc || {})) {
        current[field] = (current[field] || 0) + increment
      }
      if (update.$push?.paragraphs?.$each) {
        current.paragraphs = [...(current.paragraphs || []), ...update.$push.paragraphs.$each]
      }
      documents.set(filter._id, current)
    },
    async createIndex() {},
  }
  return {
    documents,
    db: { collection: () => collection },
  }
}

test('章节分批追加时保留已经写入的段落', async () => {
  const { db, documents } = createMemoryMongo()
  const chapter = { id: 'chapter-1', title: '第一章', wordCount: 6, sortOrder: 1 }
  let sequence = 0
  const options = {
    db,
    bookId: 'book-1',
    chapter,
    idFactory: () => `paragraph-${++sequence}`,
    clock: () => new Date('2026-07-12T00:00:00.000Z'),
  }

  await syncChapterDocument({ ...options, content: '第一段\n\n第二段', replace: true })
  await syncChapterDocument({ ...options, content: '第三段', replace: false })

  assert.deepEqual(
    documents.get(chapter.id).paragraphs.map(({ content }) => content),
    ['第一段', '第二段', '第三段'],
  )
  assert.equal(documents.get(chapter.id).word_count, 9)
})

test('任一分批写入失败时向上抛错，避免任务被误报为成功', async () => {
  let calls = 0
  const repository = {
    async appendParagraphs() {
      calls += 1
      if (calls === 2) throw new Error('MongoDB unavailable')
      return 1
    },
  }
  const storage = new StorageService('crawler', repository)
  const paragraphs = ['a'.repeat(150 * 1024), 'b'.repeat(150 * 1024)]

  await assert.rejects(
    storage.saveChapterContent('chapter-1', paragraphs),
    /batch 2\/2 失败: MongoDB unavailable/,
  )
})

test('重复保存同一本书的同名章节时复用原记录', async () => {
  const original = {
    findFirst: prisma.readBookChapter.findFirst,
    findMany: prisma.readBookChapter.findMany,
    create: prisma.readBookChapter.create,
    updateBook: prisma.readBook.update,
  }
  let createCalls = 0
  prisma.readBookChapter.findFirst = async () => ({
    id: 'chapter-existing',
    bookId: 'book-1',
    title: '第一章',
    wordCount: 0,
    sortOrder: 1,
  })
  prisma.readBookChapter.findMany = async () => []
  prisma.readBookChapter.create = async () => { createCalls += 1 }
  prisma.readBook.update = async () => ({})

  try {
    const chapter = await bookRepository.createChapterWithContent('book-1', '第一章', '')
    assert.equal(chapter.id, 'chapter-existing')
    assert.equal(createCalls, 0)
  } finally {
    prisma.readBookChapter.findFirst = original.findFirst
    prisma.readBookChapter.findMany = original.findMany
    prisma.readBookChapter.create = original.create
    prisma.readBook.update = original.updateBook
  }
})
