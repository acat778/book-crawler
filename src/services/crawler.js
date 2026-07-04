import * as cheerio from 'cheerio';
import { StorageService } from '../store/storage.js';
import { fetchHtml, openPage } from './browser.js';
import { getAdapter } from '../sites/registry.js';
import { bookRepository } from '../persistence/book-repository.js';
import config from '../config.js';

/**
 * 爬虫服务 — 爬取书籍信息、目录和章节内容
 *
 * 支持多站点（通过 SiteAdapter 扩展），当前适配的站点见 src/sites/registry.js
 *
 * 爬取流程（站点无关）：
 * 1. 解析页面元数据（委托 adapter.parseBookMeta）
 * 2. 查找已有书籍 → 找到则跳过创建流程
 * 3. 若未找到：创建作者 → 分类/标签 → 上传封面 → 创建书籍（含分类ID+标签ID）
 * 4. 初始化/恢复爬取状态（本地文件 data/crawls/）
 * 5. 逐章爬取并写入
 *
 * 持久化策略：
 * - 所有元数据（作者/分类/标签/书籍/章节/段落）通过 REST API 操作
 * - 爬取状态通过本地 JSON 文件追踪
 */
export class CrawlerService {

  constructor() {
    this.storage = new StorageService(config.crawler.userId);
  }

  // ==================== 搜索 ====================

  /**
   * 搜索书籍（委托给站点适配器）
   * @param {string} keyword
   * @param {number} [page=0]
   * @param {string} [siteId='69shuba']
   * @returns {Promise<{results: Array<{title:string, url:string, snippet:string}>, hasMore: boolean}>}
   */
  async search(keyword, page = 0, siteId = '69shuba') {
    const adapter = getAdapter(siteId);
    return adapter.search(keyword, page);
  }

  // ==================== 爬取完整书籍 ====================

  /**
   * 爬取一本书的完整信息（含目录和章节）
   *
   * @param {string} bookUrl - 书籍页面 URL
   * @param {number} [maxChapters=0] - 最多爬取的章节数，0 表示全部
   * @param {string} [siteId='69shuba'] - 站点标识
   */
  async crawl(bookUrl, maxChapters = 0, siteId = '69shuba') {
    const adapter = getAdapter(siteId);

    let bookId = null;
    let book = null;
    let authorId = null;
    let authorName = null;
    let categoryName = null;
    let coverUrl = null;
    let title = null;
    let bookStatus = 0;
    let introduction = '';
    let statusText = '';
    let tags = [];
    const tagIds = [];

    try {
      console.log(`[Crawler] 开始爬取书籍: ${bookUrl} (site=${siteId})`);

      // ===== PHASE 1: 获取并解析书籍详情页 =====
      const result = await this.#fetchBookDetail(bookUrl, adapter);
      if (!result.success) return result;

      ({
        title, authorName, categoryName, introduction,
        statusText, coverUrl, tags,
      } = result);

      bookStatus = this.#parseStatus(statusText);

      console.log(`[Crawler] 书籍信息: title=${title}, author=${authorName}, category=${categoryName}, status=${bookStatus}`);

      // ===== PHASE 2: 查找已有书籍（最优先） =====
      const existingBook = await this.storage.findExistingBook(title, authorName || '佚名');

      if (existingBook) {
        book = existingBook;
        bookId = existingBook.id;
        authorId = existingBook.authorId;
        console.log(`[Crawler] 书籍已存在: bookId=${bookId}, title=${title}`);
      } else {
        // ===== 2a: 创建作者 =====
        authorId = await this.storage.findOrCreateAuthor(authorName || '佚名');

        // ===== 2b: 创建分类和标签 =====
        let categoryId = '';
        if (categoryName) {
          categoryId = await this.storage.findOrCreateCategory(categoryName) || '';
        }
        // 批量查找或创建标签（crawler API 批量 match + 逐个 create）
        const nonCategoryTags = tags.filter(t => t !== categoryName);
        const matchedTags = await this.storage.findOrCreateTags(nonCategoryTags);
        for (const { id } of matchedTags) {
          tagIds.push(id);
        }

        // ===== 2c: 上传封面 =====
        const coverId = await this.storage.uploadCover(coverUrl);

        // ===== 2d: 创建书籍（含分类 ID + 标签 ID，一步完成） =====
        book = await this.storage.createBook({
          title,
          authorId,
          coverId,
          description: introduction || '',
          category: categoryId,
          status: bookStatus,
          isAdult: adapter.isAdult,
          tagIds,
        });
        bookId = book.id;
        console.log(`[Crawler] 新书籍已创建: bookId=${bookId}`);
      }

      // ===== PHASE 3: 获取目录并初始化/恢复爬取状态 =====
      const thirdBookId = adapter.extractBookId(bookUrl);
      if (!thirdBookId) {
        console.warn('[Crawler] 无法提取第三方书籍 ID，跳过目录爬取');
        return {
          success: true,
          message: '书籍元数据已保存（无目录）',
          title,
          author: authorName,
          category: categoryName,
          bookId,
          chapterCount: 0,
          crawledChapters: 0,
          cover: coverUrl,
        };
      }

      const catalogUrl = adapter.buildCatalogUrl(thirdBookId);
      console.log(`[Crawler] 加载目录页: ${catalogUrl}`);

      const catalogHtml = await fetchHtml(catalogUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
        waitSelector: adapter.getCatalogWaitSelector(),
      });

      if (!catalogHtml) {
        console.warn('[Crawler] 目录页加载失败');
        return {
          success: true,
          message: '书籍元数据已保存（目录页加载失败）',
          title,
          author: authorName,
          category: categoryName,
          bookId,
          chapterCount: 0,
          crawledChapters: 0,
          cover: coverUrl,
        };
      }

      const catalog$ = cheerio.load(catalogHtml);
      const allChapterLinks = adapter.parseChapterLinks(catalog$);
      if (allChapterLinks.length === 0) {
        console.warn('[Crawler] 未找到章节链接');
        return {
          success: true,
          message: '书籍元数据已保存（无章节链接）',
          title,
          author: authorName,
          category: categoryName,
          bookId,
          chapterCount: 0,
          crawledChapters: 0,
          cover: coverUrl,
        };
      }

      console.log(`[Crawler] 找到 ${allChapterLinks.length} 个章节`);

      // 检查爬取状态：是否已有部分章节已完成
      const existingCrawlRecord = await this.storage.getCrawlRecord(bookId);
      let chapterLinks = allChapterLinks;

      if (existingCrawlRecord) {
        const crawledUrls = await this.storage.getCrawledChapterUrls(bookId);
        chapterLinks = allChapterLinks.filter(link => !crawledUrls.has(link.url));
        console.log(`[Crawler] 恢复爬取: bookId=${bookId}, 已爬取=${crawledUrls.size}, 待爬取=${chapterLinks.length}`);

        if (chapterLinks.length === 0) {
          console.log('[Crawler] 所有章节已完成，无需爬取');
          return {
            success: true,
            message: '所有章节已完成',
            title,
            author: authorName,
            category: categoryName,
            bookId,
            chapterCount: allChapterLinks.length,
            crawledChapters: crawledUrls.size,
            cover: coverUrl,
          };
        }
      } else {
        await this.storage.initCrawlRecord(
          bookId, title, authorName || '佚名', bookUrl, catalogUrl, allChapterLinks,
        );
      }

      // ===== PHASE 4: 逐章爬取 =====
      const chaptersToCrawl = maxChapters > 0 ? chapterLinks.slice(0, maxChapters) : chapterLinks;

      // 标记为爬取中（本地文件 + WS 推送状态）
      await this.storage.setCrawlBookStatus(bookId, 'crawling');
      bookRepository.reportTaskStatus(bookId, 'crawling', { total: chaptersToCrawl.length, title }).catch(() => {});
      console.log(`[Crawler] 开始爬取 ${chaptersToCrawl.length} 个章节`);

      // 打开目录页（保留会话以绕过 Cloudflare）
      const catalogPage = await this.#openCatalogPage(catalogUrl, adapter);

      let savedCount = 0;
      for (const { title: chapterTitle, url: chapterUrl, sortOrder } of chaptersToCrawl) {
        if (!chapterTitle) continue;

        try {
          // 4a. 先爬取章节内容（获取真实 wordCount）
          const paragraphs = await this.crawlChapterContent(chapterUrl, catalogPage, siteId);

          if (paragraphs.length > 0) {
            const wordCount = paragraphs.reduce((sum, p) => sum + p.length, 0);

            // 4b. 通过 crawler API 创建章节并同步内容（含 \\n\\n 分段，一步完成）
            const chapter = await this.storage.createChapterWithContent(bookId, chapterTitle, paragraphs);
            await this.storage.recordCrawledChapter(bookId, chapter.id, chapterTitle, chapterUrl, chapter.sortOrder, wordCount);
            savedCount++;
          } else {
            const chapter = await this.storage.createChapter(bookId, chapterTitle, sortOrder, 0);
            await this.storage.recordFailedChapter(bookId, chapter.id, chapterTitle, chapterUrl, sortOrder);
            console.warn(`[Crawler] 章节正文为空: ${chapterTitle}`);
          }
        } catch (err) {
          console.warn(`[Crawler] 章节爬取失败: ${chapterTitle} - ${err.message}`);
          try {
            await this.storage.recordFailedChapter(
              bookId, `failed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, chapterTitle, chapterUrl, sortOrder,
            );
          } catch { /* ignore */ }
        }
      }

      // ===== PHASE 5: 完成 =====
      await this.storage.setCrawlBookStatus(bookId, 'completed');
      bookRepository.reportTaskStatus(bookId, 'completed', { crawled: savedCount, total: chaptersToCrawl.length, title }).catch(() => {});

      console.log(`[Crawler] 爬取完成: bookId=${bookId}, saved=${savedCount}/${chaptersToCrawl.length}`);
      return {
        success: true,
        message: '爬取完成',
        title,
        author: authorName,
        category: categoryName,
        bookId,
        chapterCount: savedCount,
        crawledChapters: savedCount,
        cover: coverUrl,
      };
    } catch (err) {
      console.error(`[Crawler] 爬取失败: ${bookUrl}`, err.message);
      if (bookId) {
        try {
          await this.storage.setCrawlBookStatus(bookId, 'failed');
          bookRepository.reportTaskStatus(bookId, 'failed', { error: err.message }).catch(() => {});
        } catch { /* ignore */ }
      }
      return { success: false, message: `爬取失败: ${err.message}` };
    }
  }

  // ==================== 爬取单个章节内容 ====================

  /**
   * 爬取单个章节的内容（使用已认证的 page 对象以绕过 Cloudflare）
   * @param {string} chapterUrl - 章节页面 URL
   * @param {import('puppeteer').Page} [existingPage] - 可复用的 Page
   * @param {string} [siteId='69shuba'] - 站点标识
   * @returns {Promise<string[]>} 段落数组
   */
  async crawlChapterContent(chapterUrl, existingPage = null, siteId = '69shuba') {
    const adapter = getAdapter(siteId);
    const page = existingPage;
    try {
      if (!page) {
        const ctx = await openPage(chapterUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        if (!ctx) return [];
        await this.#waitForCloudflare(ctx.page);
        const html = await ctx.page.content();
        const $ = cheerio.load(html);
        return adapter.extractChapterParagraphs($);
      }

      await page.goto(chapterUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      const cfPassed = await this.#waitForCloudflare(page);
      if (!cfPassed) {
        console.warn(`[Crawler] Cloudflare 挑战未通过: ${chapterUrl}`);
        return [];
      }

      const html = await page.content();
      const $ = cheerio.load(html);
      return adapter.extractChapterParagraphs($);
    } catch (err) {
      console.error(`[Crawler] 爬取章节内容失败: ${chapterUrl}`, err.message);
      return [];
    }
  }

  // ==================== 内部方法：书籍详情页 ====================

  /**
   * 获取并解析书籍详情页（Puppeteer 交互 + adapter 解析）
   */
  async #fetchBookDetail(bookUrl, adapter) {
    const pageCtx = await openPage(bookUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
      waitSelector: adapter.getBookDetailWaitSelector(),
    });

    if (!pageCtx) {
      // 回退到纯 fetch（无交互）
      const html = await fetchHtml(bookUrl);
      if (!html) return { success: false, message: '无法加载页面' };
      const $ = cheerio.load(html);
      return adapter.parseBookMeta($, html, bookUrl);
    }

    const { page } = pageCtx;
    try {
      // 站点特定的页面交互（如点击"展开"）
      await adapter.beforeParseBookDetail(page);

      const html = await page.content();

      // 尝试获取封面 URL（Puppeteer DOM 查询）
      const coverFromDom = await page.evaluate(() => {
        const img = document.querySelector('img[src*="/book/"], img[src*="/images/"], img[src*="nocover"], img[src*="uploads"], img[src*="cdn"]');
        return img ? (img.src || img.getAttribute('src')) : '';
      }).catch(() => '');

      const $ = cheerio.load(html);
      const result = adapter.parseBookMeta($, html, bookUrl);
      if (coverFromDom && !result.coverUrl) {
        result.coverUrl = coverFromDom;
      }
      return result;
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ==================== 内部方法：目录页 ====================

  /**
   * 打开目录页，返回可复用的 Page 对象
   */
  async #openCatalogPage(url, adapter) {
    const ctx = await openPage(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
      waitSelector: adapter.getCatalogWaitSelector(),
    });

    if (!ctx) {
      console.warn('[Crawler] 目录页打开失败');
      return null;
    }

    return ctx.page;
  }

  // ==================== Cloudflare ====================

  /**
   * 等待 Cloudflare JS 挑战解决
   */
  async #waitForCloudflare(page) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const bodyText = await page.evaluate(() => document.body?.innerText || '');
        if (!bodyText.includes('安全验证') &&
            !bodyText.includes('security verification') &&
            !bodyText.includes('自动程序') &&
            bodyText.length > 100) {
          return true;
        }
      } catch { /* page may be in transition */ }
    }
    return false;
  }

  // ==================== 工具方法 ====================

  /**
   * 解析书籍状态（API BookEntity.status 为 Integer: 0=连载中, 1=已完结）
   */
  #parseStatus(statusText) {
    if (!statusText) return 0;
    const t = statusText.toLowerCase();
    if (t.includes('完结') || t.includes('完本') || t.includes('completed') || t.includes('finished')) {
      return 1;
    }
    if (t.includes('连载') || t.includes('ongoing') || t.includes('serial')) {
      return 0;
    }
    return 0;
  }
}

export const crawlerService = new CrawlerService();
