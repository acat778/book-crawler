import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';

const { googleSearchUrl, baseUrl } = config.crawler;

/**
 * Google 搜索服务 — 在 69shuba.com 站内按关键词搜索书籍
 * 优先使用 Puppeteer（模拟真实浏览器）以避免被 Google 拦截，
 * 若 Puppeteer 不可用则回退到 axios + cheerio。
 */
export class GoogleSearchService {

  /** @type {import('puppeteer').Browser | null} */
  #browser = null;

  /**
   * 获取或创建 Puppeteer browser 实例
   */
  async #getBrowser() {
    if (this.#browser?.isConnected()) return this.#browser;

    try {
      const puppeteer = await import('puppeteer');
      this.#browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--lang=zh-CN',
        ],
      });
      console.log('[GoogleSearch] Puppeteer 浏览器已启动');
      return this.#browser;
    } catch (err) {
      console.warn('[GoogleSearch] Puppeteer 不可用，回退到 axios:', err.message);
      return null;
    }
  }

  /**
   * 搜索书籍
   * @param {string} keyword - 搜索关键词
   * @param {number} pageNum - 页码（从 0 开始）
   * @returns {Promise<Array<{title:string, url:string, snippet:string}>>}
   */
  async search(keyword, pageNum = 0) {
    const query = `site:${baseUrl.replace('https://', '')} ${keyword}`;
    const startParam = pageNum > 0 ? `&start=${pageNum * 10}` : '';
    const url = `${googleSearchUrl}?q=${encodeURIComponent(query)}${startParam}`;

    console.log(`[GoogleSearch] 搜索: ${url}`);

    // 优先使用 Puppeteer
    const browser = await this.#getBrowser();
    if (browser) {
      return this.#searchWithPuppeteer(browser, url, keyword, pageNum);
    }

    // 回退到 axios
    return this.#searchWithAxios(url, keyword, pageNum);
  }

  /**
   * 使用 Puppeteer 搜索（模拟真实浏览器）
   */
  async #searchWithPuppeteer(browser, url, keyword, pageNum) {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // 等待搜索结果加载
      await page.waitForSelector('div.g, div[data-sokoban-container], #search', { timeout: 10000 }).catch(() => {});

      const html = await page.content();
      const $ = cheerio.load(html);
      const results = this.#parseResults($);

      console.log(`[GoogleSearch] Puppeteer 返回 ${results.length} 条结果 (keyword=${keyword}, page=${pageNum})`);
      return results;
    } catch (err) {
      console.error('[GoogleSearch] Puppeteer 搜索失败:', err.message);
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * 使用 axios 搜索（轻量回退方案）
   */
  async #searchWithAxios(url, keyword, pageNum) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const results = this.#parseResults($);

      console.log(`[GoogleSearch] Axios 返回 ${results.length} 条结果 (keyword=${keyword}, page=${pageNum})`);
      return results;
    } catch (err) {
      console.error('[GoogleSearch] 搜索失败:', err.message);
      return [];
    }
  }

  /**
   * 从 cheerio 实例中解析搜索结果
   */
  #parseResults($) {
    const results = [];
    const searchDivs = $('div.g, div[data-sokoban-container], #search div.MjjYud');

    searchDivs.each((_i, div) => {
      try {
        const $div = $(div);
        const $link = $div.find('a').first();
        const href = $link.attr('href');

        if (!href || (!href.includes('69shuba.com') && !href.includes('69shu.com'))) {
          return;
        }

        const title = $div.find('h3').first().text().trim();
        const snippet = $div.text().trim().substring(0, 200);

        if (title || href) {
          results.push({
            title: title || '(无标题)',
            url: href,
            snippet: snippet || '',
          });
        }
      } catch (_) {
        // 跳过解析失败的结果项
      }
    });

    return results;
  }
}

export const googleSearchService = new GoogleSearchService();
