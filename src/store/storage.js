import {
  initCrawlRecord,
  updateCrawlBookStatus,
  appendCrawlChapter,
  getCrawlRecord,
  listCrawlRecords,
  deleteCrawlRecord,
  getCrawledChapterUrls,
} from './crawl-tracker.js';
import { ApiClient } from '../services/api-client.js';

const COVER_FILE_ID = 0;

/**
 * 数据持久化服务（v5.0）
 *
 * - 书籍元数据操作（作者/分类/标签/书籍）通过 REST API（低频，需要同步返回 ID）
 * - 章节创建/段落追加通过 REST API（可靠持久化到后端数据库）
 * - 封面图片上传通过 REST（multipart/form-data）
 * - 爬取状态通过本地文件追踪（data/crawls/）
 */
export class StorageService {

  constructor(userId) {
    this.userId = userId;
    this.api = ApiClient.getInstance();
  }

  // ==================== 编码工具 ====================

  #dictCode(name) {
    return name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '_').replace(/_+/g, '_');
  }

  // ==================== 作者（REST — 低频，需同步返回 ID） ====================

  async findOrCreateAuthor(name) {
    if (!name || name.trim() === '') name = '佚名';

    const found = await this.api.matchAuthor(name);
    if (found) return found.id;

    const created = await this.api.createCrawlerAuthor(name, '');
    if (!created) throw new Error(`创建作者失败: ${name}`);
    console.log(`[Storage] 新增作者: ${name} (id=${created.id})`);
    return created.id;
  }

  // ==================== 分类（REST — 低频） ====================

  async findOrCreateCategory(name) {
    if (!name || name.trim() === '') return null;

    const found = await this.api.matchCategory(name);
    if (found) return found.id;

    const code = this.#dictCode(name);
    const created = await this.api.createCrawlerCategory(name, code);
    if (!created) {
      console.warn(`[Storage] 创建分类失败: ${name}`);
      return null;
    }
    console.log(`[Storage] 新增分类: ${name} (id=${created.id})`);
    return created.id;
  }

  // ==================== 标签（REST — 低频） ====================

  async findOrCreateTag(name) {
    if (!name || name.trim() === '') return null;

    const matched = await this.api.matchTags([name]);
    if (matched.length > 0) return matched[0].id;

    const code = this.#dictCode(name);
    const created = await this.api.createCrawlerTag(name, code);
    if (!created) {
      console.warn(`[Storage] 创建标签失败: ${name}`);
      return null;
    }
    console.log(`[Storage] 新增标签: ${name} (id=${created.id})`);
    return created.id;
  }

  async findOrCreateTags(names) {
    if (!names || names.length === 0) return [];

    const matched = await this.api.matchTags(names);
    const result = [...matched];
    const matchedNames = new Set(matched.map(t => t.tag));

    for (const name of names) {
      if (!name || !name.trim() || matchedNames.has(name)) continue;
      const code = this.#dictCode(name);
      const created = await this.api.createCrawlerTag(name, code);
      if (created) {
        result.push({ tag: created.name, id: created.id });
        console.log(`[Storage] 新增标签: ${name} (id=${created.id})`);
      }
    }

    return result;
  }

  // ==================== 书籍（REST — 需同步返回 bookId） ====================

  async findExistingBook(title, authorName) {
    return this.api.matchBook(title, authorName);
  }

  /**
   * 通过 crawler REST API 创建书籍（含标签关联，服务器分配 ID）
   * POST /api/book/crawler/books
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

    const result = await this.api.createCrawlerBook(param);
    if (!result) throw new Error(`创建书籍失败: ${bookData.title}`);
    console.log(`[Storage] 新增书籍: title=${bookData.title}, authorId=${bookData.authorId}, id=${result.id}`);
    return result;
  }

  // ==================== 封面上传（REST — multipart/form-data） ====================

  async uploadCover(imageUrl) {
    if (!imageUrl || imageUrl.includes('nocover')) {
      return COVER_FILE_ID;
    }
    try {
      const fileInfo = await this.api.uploadCover(imageUrl);
      return fileInfo ? fileInfo.id : COVER_FILE_ID;
    } catch (err) {
      console.warn(`[Storage] 封面上传失败: ${err.message}`);
      return COVER_FILE_ID;
    }
  }

  // ==================== 章节（REST API — 可靠持久化，大内容自动拆分） ====================

  /**
   * 创建章节（含内容），大内容自动拆分为多次追加
   * REST API 保证数据可靠写入后端数据库。
   */
  async createChapterWithContent(bookId, title, paragraphs) {
    if (!paragraphs || paragraphs.length === 0) {
      // 空内容 — 直接创建空章节
      const result = await this.api.createChapter(bookId, title, '');
      if (!result) throw new Error(`创建章节失败: ${title}`);
      return result;
    }

    const content = paragraphs.join('\n\n');
    const jsonSize = Buffer.byteLength(JSON.stringify({ bookId, title, content }), 'utf8');

    if (jsonSize <= 400 * 1024) {
      // 内容适中 — 一步创建
      const result = await this.api.createChapter(bookId, title, content);
      if (!result) throw new Error(`创建章节失败: ${title}`);
      console.log(`[Storage] 创建章节: bookId=${bookId}, title=${title}, id=${result.id}, size=${(jsonSize / 1024).toFixed(1)}KB`);
      return result;
    }

    // 内容过大 — 先创建空章节，再分批追加段落
    console.log(`[Storage] 章节过大 (${(jsonSize / 1024).toFixed(1)}KB)，拆分发送: ${title}`);
    const chapter = await this.api.createChapter(bookId, title, '');
    if (!chapter) throw new Error(`创建章节失败: ${title}`);

    // 分批追加段落（每批最多 200KB）
    await this.#appendParagraphsInBatches(chapter.id, paragraphs);
    return chapter;
  }

  /**
   * 创建空章节（无内容 / 正文为空时回退）
   */
  async createChapter(bookId, title, sortOrder, wordCount = 0) {
    const result = await this.api.createChapter(bookId, title, '');
    if (!result) throw new Error(`创建章节失败: ${title}`);
    return result;
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
        const count = await this.api.appendParagraphs(chapterId, batches[i]);
        total += count;
        if (batches.length > 1) {
          console.log(`[Storage] 追加段落 batch ${i + 1}/${batches.length}: chapterId=${chapterId}, count=${count}`);
        }
      } catch (err) {
        console.warn(`[Storage] 追加段落 batch ${i + 1}/${batches.length} 失败: ${err.message}`);
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
}
