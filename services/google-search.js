import * as cheerio from 'cheerio';
import config from '../config.js';
import { getBrowser } from './browser.js';

const { baseUrl } = config.crawler;

/**
 * 书籍搜索/浏览服务
 *
 * 搜书策略（按优先级）：
 * 1. 69shuba 分类浏览页（公开页面，国内直接访问）
 * 2. Bing 站内搜索（国内可访问，但索引有限）
 * 3. Google 站内搜索（需代理/VPN）
 */
export class SearchService {

  /**
   * 搜索/浏览书籍
   * @param {string} keyword - 搜索关键词
   * @param {number} pageNum - 页码
   * @returns {Promise<Array<{title:string, url:string, snippet:string}>>}
   */
  async search(keyword, pageNum = 0) {
    const browser = await getBrowser();

    // 策略1: 直接爬 69shuba 分类页 + 关键词筛选（最可靠）
    if (browser) {
      const results = await this.#browseCategory(browser, keyword, pageNum);
      if (results.length > 0) return results;
    }

    // 策略2: Bing 站内搜索
    {
      const results = await this.#searchEngine(browser, 'Bing',
        `https://www.bing.com/search?q=${encodeURIComponent(`site:${baseUrl.replace('https://', '')} ${keyword}`)}${pageNum > 0 ? `&first=${pageNum * 10 + 1}` : ''}`,
        'li.b_algo, ol#b_results > li',
        ($, el) => $(el).find('h2 a').attr('href') || $(el).find('a').first().attr('href'),
        ($, el) => $(el).find('h2').first().text().trim(),
        keyword
      );
      if (results.length > 0) return results;
    }

    // 策略3: Google（需翻墙）
    {
      const results = await this.#searchEngine(browser, 'Google',
        `https://www.google.com/search?q=${encodeURIComponent(`site:${baseUrl.replace('https://', '')} ${keyword}`)}${pageNum > 0 ? `&start=${pageNum * 10}` : ''}`,
        'div.g, div[data-sokoban-container], #search div.MjjYud',
        ($, el) => $(el).find('a').first().attr('href'),
        ($, el) => $(el).find('h3').first().text().trim(),
        keyword
      );
      if (results.length > 0) return results;
    }

    console.log(`[Search] 所有策略均未返回结果 (keyword=${keyword})`);
    return [];
  }

  /**
   * 策略1: 浏览 69shuba 分类页，筛选匹配关键词的书籍
   */
  async #browseCategory(browser, keyword, pageNum) {
    // 69shuba 公开分类/榜单页
    const categoryUrls = [
      `https://www.69shuba.com/novels/class/0.htm`,   // 全部分类
      `https://www.69shuba.com/novels/full`,           // 完本
      `https://www.69shuba.com/novels/hot`,            // 热门
      `https://www.69shuba.com/last.html`,             // 最新更新
    ];

    // 只取第一个页面（pageNum=0），后续页走其他策略
    if (pageNum > 0) {
      return [];
    }

    for (const url of categoryUrls) {
      try {
        console.log(`[Search] 浏览分类页: ${url}`);
        const html = await this.#fetchWithBrowser(browser, url, 'h3 a, a.btn');
        if (!html) continue;

        const $ = cheerio.load(html);
        const results = [];
        const seenUrls = new Set();

        // 从 h3 标签提取书名（69shuba 的分类页结构：h3 > a[href*=book]）
        $('h3 a[href*="/book/"]').each((_i, el) => {
          const $el = $(el);
          const href = $el.attr('href') || '';
          const title = $el.text().trim();
          if (!title || seenUrls.has(href)) return;
          seenUrls.add(href);

          if (this.#matchKeyword(title, keyword)) {
            const fullUrl = href.startsWith('http') ? href : baseUrl + href;
            results.push({ title, url: fullUrl, snippet: '' });
          }
        });

        // 也检查 a.btn 和 a[href*="/book/"] 中的书名（排除 imgbox）
        if (results.length === 0) {
          $('a[href*="/book/"]').each((_i, el) => {
            const $el = $(el);
            const href = $el.attr('href') || '';
            const title = $el.text().trim();
            // 跳过图片链接和无文字链接
            if (!title || title === '点击阅读' || seenUrls.has(href)) return;
            seenUrls.add(href);

            if (this.#matchKeyword(title, keyword)) {
              const fullUrl = href.startsWith('http') ? href : baseUrl + href;
              results.push({ title, url: fullUrl, snippet: '' });
            }
          });
        }

        if (results.length > 0) {
          console.log(`[Search] 分类页返回 ${results.length} 条匹配结果 (keyword=${keyword})`);
          return results.slice(0, 20);
        }
      } catch (err) {
        console.warn(`[Search] 分类页失败: ${url} - ${err.message}`);
      }
    }

    return [];
  }

  /** 检查标题是否匹配关键词（忽略大小写） */
  #matchKeyword(title, keyword) {
    return title.toLowerCase().includes(keyword.toLowerCase());
  }

  /**
   * 策略2/3: 通用搜索引擎
   */
  async #searchEngine(browser, name, url, resultSelector, urlResolver, titleResolver, keyword) {
    try {
      console.log(`[Search] ${name}: ${url}`);
      const html = await this.#fetchWithBrowser(browser, url, resultSelector);
      if (!html) return [];

      const $ = cheerio.load(html);
      const results = [];

      $(resultSelector).each((_i, el) => {
        try {
          const href = urlResolver($, el);
          if (!href || (!href.includes('69shuba.com') && !href.includes('69shu.com'))) return;

          const title = titleResolver($, el);
          const snippet = $(el).text().trim().substring(0, 200);

          if (title || href) {
            results.push({ title: title || '(无标题)', url: href, snippet });
          }
        } catch (_) { /* skip */ }
      });

      console.log(`[Search] ${name} 返回 ${results.length} 条结果`);
      return results;
    } catch (err) {
      console.warn(`[Search] ${name} 失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 使用 Puppeteer 获取页面 HTML
   */
  async #fetchWithBrowser(browser, url, waitSelector) {
    if (!browser) return null;

    const puppeteer = await import('puppeteer');
    const page = await browser.newPage();
    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

      if (waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: 8000 }).catch(() => {});
      }

      return await page.content();
    } catch (err) {
      console.warn(`[Search] 页面加载失败: ${url} - ${err.message}`);
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }
}

export const googleSearchService = new SearchService();
