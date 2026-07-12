import {
  initCrawlRecord,
  updateCrawlBookStatus,
  appendCrawlChapter,
  getCrawlRecord,
  listCrawlRecords,
  deleteCrawlRecord,
  getCrawledChapterUrls,
  writeCrawlRecord,
} from './crawl-tracker.js';
import { bookRepository } from '../persistence/book-repository.js';

const COVER_FILE_ID = '0';

/**
 * 数据持久化服务（v5.0）
 *
 * - 书籍元数据和章节元数据通过 Prisma 直写 MySQL
 * - 章节正文通过 MongoDB Driver 写入 MongoDB
 * - 封面图片通过 S3 SDK 写入 RustFS
 * - 爬取状态通过本地文件追踪（data/crawls/）
 */
export class StorageService {

  constructor(userId, repository = bookRepository) {
    this.userId = userId;
    this.repository = repository;
  }

  // ==================== 编码工具 ====================

  #dictCode(name) {
    return name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '_').replace(/_+/g, '_');
  }

  // ==================== 作者 ====================

  async findOrCreateAuthor(name) {
    if (!name || name.trim() === '') name = '佚名';

    return this.repository.findOrCreateAuthor(name);
  }

  // ==================== 分类 ====================

  async findOrCreateCategory(name) {
    if (!name || name.trim() === '') return null;

    return this.repository.findOrCreateCategory(name);
  }

  // ==================== 标签 ====================

  async findOrCreateTag(name) {
    if (!name || name.trim() === '') return null;

    const matched = await this.repository.findOrCreateTags([name]);
    return matched[0]?.id || null;
  }

  async findOrCreateTags(names) {
    if (!names || names.length === 0) return [];

    return this.repository.findOrCreateTags(names);
  }

  // ==================== 书籍 ====================

  async findExistingBook(title, authorName) {
    return this.repository.findExistingBook(title, authorName);
  }

  /**
   * 创建书籍并写入标签关联。
   */
  async createBook(bookData) {
    const param = {
      title: bookData.title,
      authorId: bookData.authorId,
      description: bookData.description || '',
      category: bookData.category || '',
      status: bookData.status ?? 0,
      isAdult: bookData.isAdult ?? 0,
    };

    if (bookData.coverId && bookData.coverId !== COVER_FILE_ID) {
      param.coverId = bookData.coverId;
    }
    if (bookData.tagIds && bookData.tagIds.length > 0) {
      param.tagIds = bookData.tagIds;
    }

    const result = await this.repository.createBook(param);
    console.log(`[Storage] 新增书籍: title=${bookData.title}, authorId=${bookData.authorId}, id=${result.id}`);
    return result;
  }

  // ==================== 封面上传 ====================

  async uploadCover(imageUrl) {
    if (!imageUrl || imageUrl.includes('nocover')) {
      return COVER_FILE_ID;
    }
    try {
      return await this.repository.uploadCover(imageUrl);
    } catch (err) {
      console.warn(`[Storage] 封面上传失败: ${err.message}`);
      return COVER_FILE_ID;
    }
  }

  // ==================== 章节（大内容自动拆分） ====================

  /**
   * 创建章节（含内容），大内容自动拆分为多次追加
   * 分批写入失败时向上抛错，避免任务误报成功。
   */
  async createChapterWithContent(bookId, title, paragraphs) {
    if (!paragraphs || paragraphs.length === 0) {
      // 空内容 — 直接创建空章节
      return this.repository.createChapterWithContent(bookId, title, '');
    }

    const content = paragraphs.join('\n\n');
    const jsonSize = Buffer.byteLength(JSON.stringify({ bookId, title, content }), 'utf8');

    if (jsonSize <= 400 * 1024) {
      // 内容适中 — 一步创建
      const result = await this.repository.createChapterWithContent(bookId, title, content);
      console.log(`[Storage] 创建章节: bookId=${bookId}, title=${title}, id=${result.id}, size=${(jsonSize / 1024).toFixed(1)}KB`);
      return result;
    }

    // 内容过大 — 先创建空章节，再分批追加段落
    console.log(`[Storage] 章节过大 (${(jsonSize / 1024).toFixed(1)}KB)，拆分发送: ${title}`);
    const chapter = await this.repository.createChapterWithContent(bookId, title, '');

    // 分批追加段落（每批最多 200KB）
    await this.#appendParagraphsInBatches(chapter.id, paragraphs);
    return chapter;
  }

  /**
   * 创建空章节（无内容 / 正文为空时回退）
   */
  async createChapter(bookId, title, sortOrder, wordCount = 0) {
    return this.repository.createChapterWithContent(bookId, title, '');
  }

  /**
   * 追加段落到已有章节（大内容自动拆分）
   */
  async saveChapterContent(chapterId, paragraphs) {
    if (!paragraphs || paragraphs.length === 0) return 0;
    return this.#appendParagraphsInBatches(chapterId, paragraphs);
  }

  /**
   * 分批追加段落（每批约 200KB，避免单次请求过大）
   * @returns {number} 总追加段落数
   */
  async #appendParagraphsInBatches(chapterId, paragraphs) {
    const MAX_BATCH_SIZE = 200 * 1024; // 200KB per batch
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;

    for (const p of paragraphs) {
      const pSize = Buffer.byteLength(p, 'utf8') + 2; // +2 for \n\n
      if (currentSize + pSize > MAX_BATCH_SIZE && currentBatch.length > 0) {
        batches.push(currentBatch.join('\n\n'));
        currentBatch = [];
        currentSize = 0;
      }
      currentBatch.push(p);
      currentSize += pSize;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch.join('\n\n'));
    }

    let total = 0;
    for (let i = 0; i < batches.length; i++) {
      try {
        const count = await this.repository.appendParagraphs(chapterId, batches[i]);
        total += count;
        if (batches.length > 1) {
          console.log(`[Storage] 追加段落 batch ${i + 1}/${batches.length}: chapterId=${chapterId}, count=${count}`);
        }
      } catch (err) {
        throw new Error(
          `追加段落 batch ${i + 1}/${batches.length} 失败: ${err.message}`,
          { cause: err },
        );
      }
    }
    return total;
  }

  // ==================== 爬取状态追踪（本地文件） ====================

  async initCrawlRecord(bookId, title, authorName, url, catalogUrl, chapterLinks) {
    return initCrawlRecord(bookId, title, authorName, url, catalogUrl, chapterLinks);
  }

  async setCrawlBookStatus(bookId, status) {
    return updateCrawlBookStatus(bookId, status);
  }

  async recordCrawledChapter(bookId, chapterId, title, url, sortOrder, wordCount) {
    return appendCrawlChapter(bookId, chapterId, title, url, sortOrder, 'crawled', wordCount);
  }

  async recordFailedChapter(bookId, chapterId, title, url, sortOrder) {
    return appendCrawlChapter(bookId, chapterId, title, url, sortOrder, 'failed', 0);
  }

  async getCrawlRecord(bookId) {
    return getCrawlRecord(bookId);
  }

  async listCrawlRecords() {
    return listCrawlRecords();
  }

  async deleteCrawlRecord(bookId) {
    return deleteCrawlRecord(bookId);
  }

  async getCrawledChapterUrls(bookId) {
    return getCrawledChapterUrls(bookId);
  }

  async writeCrawlRecord(bookId, data) {
    return writeCrawlRecord(bookId, data);
  }
}
