import * as cheerio from 'cheerio';
import config from '../config.js';
import { generateId, query, queryOne, insert } from '../db/mysql.js';
import { saveParagraphs } from '../db/mongodb.js';
import { googleSearchService } from './google-search.js';
import { fetchHtml } from './browser.js';

const { baseUrl, selectors } = config.crawler;

const CATEGORY_DICT_ID = 1;
const TAG_DICT_ID = 2;
const COVER_FILE_ID = 0;

/**
 * 爬虫服务 — 爬取 69shuba.com 书籍信息、目录和章节内容
 */
export class CrawlerService {

  // ==================== 搜索 ====================

  /**
   * 通过 Google 搜索书籍
   */
  async search(keyword, page = 0) {
    return googleSearchService.search(keyword, page);
  }

  // ==================== 爬取 ====================

  /**
   * 爬取一本书的完整信息
   * @param {string} bookUrl - 书籍页面 URL
   * @returns {Promise<{success:boolean, message:string, title?:string, author?:string, category?:string, bookId?:number, chapterCount?:number, crawledChapters?:number}>}
   */
  async crawl(bookUrl) {
    try {
      console.log(`[Crawler] 开始爬取书籍: ${bookUrl}`);

      const html = await this._fetchPage(bookUrl);
      const $ = cheerio.load(html);

      // 提取书籍信息
      const title = this._text($, selectors.book.title);
      const authorName = this._text($, selectors.book.author);
      const categoryName = this._text($, selectors.book.category);
      const statusText = this._text($, selectors.book.status);

      // 尝试获取简介（可能需要展开）
      let introduction = this._text($, selectors.book.introduction);
      if (!introduction) {
        // 尝试另一种选择器
        introduction = this._text($, 'div.intro, .intro, [class*="intro"] p');
      }

      // 提取标签
      const tags = [];
      $(selectors.book.tags).each((_i, el) => {
        const tagText = $(el).text().trim();
        if (tagText) tags.push(tagText);
      });

      if (!title) {
        return { success: false, message: '无法提取书籍标题' };
      }

      console.log(`[Crawler] 书籍信息: title=${title}, author=${authorName}, category=${categoryName}`);

      // 持久化数据
      const authorId = await this._findOrCreateAuthor(authorName || '佚名');
      if (categoryName) {
        await this._findOrCreateDictData(CATEGORY_DICT_ID, categoryName);
      }
      for (const tag of tags) {
        await this._findOrCreateDictData(TAG_DICT_ID, tag);
      }

      const bookStatus = this._parseStatus(statusText);
      const book = await this._findOrCreateBook(title, authorId, categoryName, introduction, bookStatus);

      // 爬取目录和章节
      const chapterCount = await this._crawlChapters($, book.id, bookUrl);

      return {
        success: true,
        message: '爬取完成',
        title,
        author: authorName,
        category: categoryName,
        bookId: book.id,
        chapterCount,
        crawledChapters: chapterCount,
      };
    } catch (err) {
      console.error(`[Crawler] 爬取失败: ${bookUrl}`, err.message);
      return { success: false, message: `爬取失败: ${err.message}` };
    }
  }

  // ==================== 章节内容爬取 ====================

  /**
   * 爬取单个章节的内容
   * @param {string} chapterUrl - 章节页面 URL
   * @returns {Promise<string[]>} 段落数组
   */
  async crawlChapterContent(chapterUrl) {
    try {
      const html = await this._fetchPage(chapterUrl);
      const $ = cheerio.load(html);

      // 尝试多种选择器获取内容区
      const contentEl = $(selectors.chapter.content);
      if (!contentEl.length) {
        // 尝试备选选择器
        const altContent = $('#content, .content, [class*="content"] article, .chapter-content');
        if (!altContent.length) return [];
        const fullText = altContent.first().text();
        return this._splitParagraphs(fullText);
      }

      const fullText = contentEl.text();
      return this._splitParagraphs(fullText);
    } catch (err) {
      console.error(`[Crawler] 爬取章节内容失败: ${chapterUrl}`, err.message);
      return [];
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 爬取目录中的所有章节
   */
  async _crawlChapters($, bookId, bookUrl) {
    try {
      const catalog = $(selectors.chapter.catalog);
      if (!catalog.length) {
        console.warn('[Crawler] 未找到目录元素 #catalog');
        return 0;
      }

      const items = catalog.find('li');
      let count = 0;
      let sortOrder = 1;

      for (const liEl of items.toArray()) {
        const $li = $(liEl);
        const $anchor = $li.find('a').first();
        if (!$anchor.length) continue;

        const chapterTitle = $anchor.text().trim();
        let chapterUrl = $anchor.attr('href') || '';

        if (!chapterTitle) continue;

        // 补全相对 URL
        if (chapterUrl && !chapterUrl.startsWith('http')) {
          chapterUrl = baseUrl + chapterUrl;
        }

        // 创建章节记录
        const chapter = await this._findOrCreateChapter(bookId, chapterTitle, sortOrder);

        // 爬取章节内容
        if (chapterUrl) {
          try {
            const paragraphs = await this.crawlChapterContent(chapterUrl);
            if (paragraphs.length > 0) {
              await saveParagraphs(bookId, chapter.id, paragraphs);
              const wordCount = paragraphs.reduce((sum, p) => sum + p.length, 0);
              await query(
                'UPDATE t_book_chapter SET word_count = ? WHERE id = ?',
                [wordCount, chapter.id]
              );
            }
          } catch (err) {
            console.warn(`[Crawler] 爬取章节内容失败: ${chapterTitle} - ${err.message}`);
          }
        }

        count++;
        sortOrder++;
      }

      console.log(`[Crawler] 目录爬取完成: bookId=${bookId}, chapters=${count}`);
      return count;
    } catch (err) {
      console.error(`[Crawler] 爬取目录失败: bookId=${bookId}`, err.message);
      return 0;
    }
  }

  // ==================== 数据持久化 ====================

  /**
   * 查找或创建作者
   */
  async _findOrCreateAuthor(name) {
    if (!name || name.trim() === '') name = '佚名';

    const existing = await queryOne(
      'SELECT id FROM t_book_user_author WHERE name = ? AND is_deleted = 0',
      [name]
    );
    if (existing) return existing.id;

    const id = generateId();
    const now = new Date();
    await insert(
      `INSERT INTO t_book_user_author (id, user_id, name, status, is_deleted, create_by, update_by, created_at, updated_at, version)
       VALUES (?, 0, ?, 1, 0, 0, 0, ?, ?, 1)`,
      [id, name, now, now]
    );
    console.log(`[Crawler] 新增作者: ${name}`);
    return id;
  }

  /**
   * 查找或创建字典数据项
   */
  async _findOrCreateDictData(dictId, name) {
    if (!name || name.trim() === '') return null;

    const existing = await queryOne(
      'SELECT id FROM t_book_dict_data WHERE dict_id = ? AND name = ? AND is_deleted = 0',
      [dictId, name]
    );
    if (existing) return existing.id;

    const code = name.toLowerCase().replace(/[^a-z0-9一-龥]/g, '_');
    const id = generateId();
    const now = new Date();
    await insert(
      `INSERT INTO t_book_dict_data (id, dict_id, parent_id, code, name, value, i18n_code, sort_order, is_enabled, is_deleted, create_by, update_by, created_at, updated_at, version)
       VALUES (?, ?, 0, ?, ?, ?, 'zh-CN', 0, 1, 0, 0, 0, ?, ?, 1)`,
      [id, dictId, code, name, name, now, now]
    );
    console.log(`[Crawler] 新增字典数据项: dictId=${dictId}, name=${name}`);
    return id;
  }

  /**
   * 查找或创建书籍
   */
  async _findOrCreateBook(title, authorId, category, description, status) {
    const existing = await queryOne(
      'SELECT * FROM t_book WHERE title = ? AND author_id = ? AND is_deleted = 0',
      [title, authorId]
    );

    if (existing) {
      // 更新已有书籍
      const updates = [];
      const params = [];
      if (description) { updates.push('description = ?'); params.push(description); }
      if (category) { updates.push('category = ?'); params.push(category); }
      if (status) { updates.push('status = ?'); params.push(status); }
      if (updates.length > 0) {
        await query(
          `UPDATE t_book SET ${updates.join(', ')} WHERE id = ?`,
          [...params, existing.id]
        );
      }
      return existing;
    }

    const id = generateId();
    const now = new Date();
    await insert(
      `INSERT INTO t_book (id, title, author_id, cover_id, description, category, status, word_count, chapter_count, rating, is_deleted, create_by, update_by, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0.0, 0, 0, 0, ?, ?, 1)`,
      [id, title, authorId, COVER_FILE_ID, description || '', category || '', status || 'ongoing', now, now]
    );
    console.log(`[Crawler] 新增书籍: title=${title}, authorId=${authorId}`);
    return { id, title, authorId, category, status };
  }

  /**
   * 查找或创建章节
   */
  async _findOrCreateChapter(bookId, title, sortOrder) {
    const existing = await queryOne(
      'SELECT * FROM t_book_chapter WHERE book_id = ? AND title = ? AND is_deleted = 0',
      [bookId, title]
    );
    if (existing) return existing;

    const id = generateId();
    const now = new Date();
    await insert(
      `INSERT INTO t_book_chapter (id, book_id, title, word_count, sort_order, is_deleted, create_by, update_by, created_at, updated_at, version)
       VALUES (?, ?, ?, 0, ?, 0, 0, 0, ?, ?, 1)`,
      [id, bookId, title, sortOrder, now, now]
    );
    return { id, bookId, title, sortOrder };
  }

  // ==================== 工具方法 ====================

  /**
   * 获取页面 HTML（优先 Puppeteer，回退 axios）
   */
  async _fetchPage(url) {
    return fetchHtml(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
      waitSelector: '#catalog, h1, .chapter-content',
    });
  }

  /**
   * 使用 CSS 选择器提取文本内容
   */
  _text($, selector) {
    const el = $(selector);
    if (!el.length) return null;
    return el.first().text().trim() || null;
  }

  /**
   * 解析书籍状态
   */
  _parseStatus(statusText) {
    if (!statusText) return 'ongoing';
    if (statusText.includes('完结') || statusText.includes('完本')) return 'completed';
    return 'ongoing';
  }

  /**
   * 将文本按空行拆分为段落
   */
  _splitParagraphs(text) {
    if (!text) return [];
    const parts = text.split(/\n\s*\n/);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
  }
}

export const crawlerService = new CrawlerService();
