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

      // 优先从 meta 标签提取信息（最可靠）
      const metaTag = (name) => $(`meta[property="${name}"]`).attr('content') || '';

      const title = metaTag('og:title') || this._text($, 'h1 a') || this._text($, 'h1');
      const authorName = metaTag('og:novel:author');
      const categoryName = metaTag('og:novel:category');
      const introduction = metaTag('og:description').replace(/<br\s*\/?>/gi, '\n');
      let statusText = metaTag('og:novel:status');

      // fallback: 从可见文本提取
      if (!authorName) {
        const authorP = $('p').filter((_i, el) => $(el).text().includes('作者')).first();
        const authorLink = authorP.find('a').first().text().trim();
        if (authorLink) statusText = statusText; // keep as-is
      }

      if (!title) {
        return { success: false, message: '无法提取书籍标题' };
      }

      console.log(`[Crawler] 书籍信息: title=${title}, author=${authorName}, category=${categoryName}`);

      // 持久化数据
      const authorId = await this._findOrCreateAuthor(authorName || '佚名');
      if (categoryName) {
        await this._findOrCreateDictData(CATEGORY_DICT_ID, categoryName);
      }

      const bookStatus = this._parseStatus(statusText);
      const book = await this._findOrCreateBook(title, authorId, categoryName, introduction, bookStatus);

      // 爬取目录和章节 — 目录可能在独立页面（如 /book/12345/）
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
      // 尝试多种内容区选择器
      const contentSelectors = [
        '#content', '.content', '#chaptercontent', '.chapter-content',
        '[class*="content"]', 'article', '#htmlContent',
        'body > div:nth-child(2) > div:nth-child(1) > div:nth-child(3)',
      ];
      let fullText = '';
      for (const sel of contentSelectors) {
        const el = $(sel);
        if (el.length) {
          fullText = el.first().text();
          if (fullText.trim().length > 50) break;
        }
      }
      if (!fullText) return [];

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
      // 目录页面 URL：将 /book/12345.htm 转为 /book/12345/
      let catalogUrl = bookUrl.replace(/\.htm$/, '/');
      // 如果已经是 /book/12345/ 格式，保持一致
      if (!catalogUrl.endsWith('/')) {
        catalogUrl = bookUrl.replace(/\.htm.*$/, '/');
      }

      console.log(`[Crawler] 加载目录页: ${catalogUrl}`);
      let catalogHtml;
      try {
        catalogHtml = await this._fetchPage(catalogUrl);
      } catch {
        // 目录页加载失败，尝试从原页面提取
        catalogHtml = $.html();
      }

      const $catalog = cheerio.load(catalogHtml);

      // 尝试多种目录选择器
      let chapterLinks = [];
      const selectors = [
        'ul.chapterlist a, ul.list a, .catalog a',
        'div.catalog a, #catalog a',
        'a[href*="/txt/"]',
        '.book_last Chapter a, .chapter a',
        'ul li a[href*="/txt/"]',
      ];

      for (const sel of selectors) {
        $catalog(sel).each((_i, el) => {
          const href = $catalog(el).attr('href') || '';
          const text = $catalog(el).text().trim();
          if (href && text) {
            chapterLinks.push({
              title: text,
              url: href.startsWith('http') ? href : baseUrl + href,
            });
          }
        });
        if (chapterLinks.length > 0) break;
      }

      if (chapterLinks.length === 0) {
        console.warn('[Crawler] 未找到章节链接');
        return 0;
      }

      console.log(`[Crawler] 找到 ${chapterLinks.length} 个章节`);

      let count = 0;
      for (let i = 0; i < chapterLinks.length; i++) {
        const { title: chapterTitle, url: chapterUrl } = chapterLinks[i];

        if (!chapterTitle) continue;

        // 创建章节记录
        const chapter = await this._findOrCreateChapter(bookId, chapterTitle, i + 1);

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
