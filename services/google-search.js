import * as cheerio from 'cheerio';
import config from '../config.js';
import { getBrowser } from './browser.js';

const { googleSearchUrl, baseUrl } = config.crawler;

/**
 * 搜索引擎服务 — 在 69shuba.com 站内按关键词搜索书籍
 *
 * 优先使用 Bing（国内可直接访问），若不可用则回退到 Google。
 * 使用 Puppeteer 模拟真实浏览器以避免被拦截。
 */
export class SearchService {

  /**
   * 搜索引擎配置：优先 Bing（国内可访问），其次 Google
   */
  #engines = [
    {
      name: 'Bing',
      buildUrl: (query, pageNum) => {
        const q = `site:${baseUrl.replace('https://', '')} ${query}`;
        const first = pageNum > 0 ? `&first=${pageNum * 10 + 1}` : '';
        return `https://www.bing.com/search?q=${encodeURIComponent(q)}${first}`;
      },
      resultSelector: 'li.b_algo, ol#b_results > li',
      urlResolver: ($, el) => {
        const $el = $(el);
        return $el.find('h2 a').attr('href') || $el.find('a').first().attr('href');
      },
      titleResolver: ($, el) => $(el).find('h2').first().text().trim(),
      hostMatch: (href) => href && (href.includes('69shuba.com') || href.includes('69shu.com')),
    },
    {
      name: 'Google',
      buildUrl: (query, pageNum) => {
        const q = `site:${baseUrl.replace('https://', '')} ${query}`;
        const start = pageNum > 0 ? `&start=${pageNum * 10}` : '';
        return `${googleSearchUrl}?q=${encodeURIComponent(q)}${start}`;
      },
      resultSelector: 'div.g, div[data-sokoban-container], #search div.MjjYud',
      urlResolver: ($, el) => $(el).find('a').first().attr('href'),
      titleResolver: ($, el) => $(el).find('h3').first().text().trim(),
      hostMatch: (href) => href && (href.includes('69shuba.com') || href.includes('69shu.com')),
    },
  ];

  /**
   * 搜索书籍
   * @param {string} keyword - 搜索关键词
   * @param {number} pageNum - 页码（从 0 开始）
   * @returns {Promise<Array<{title:string, url:string, snippet:string}>>}
   */
  async search(keyword, pageNum = 0) {
    const browser = await getBrowser();

    // 按优先级尝试各搜索引擎
    for (const engine of this.#engines) {
      const url = engine.buildUrl(keyword, pageNum);
      console.log(`[Search] ${engine.name}: ${url}`);

      try {
        let results;
        if (browser) {
          results = await this.#searchWithPuppeteer(browser, engine, url);
        } else {
          results = await this.#searchWithAxios(engine, url);
        }

        if (results.length > 0) {
          return results;
        }
        console.log(`[Search] ${engine.name} 返回 0 条结果，尝试下一个`);
      } catch (err) {
        console.warn(`[Search] ${engine.name} 异常:`, err.message);
      }
    }

    console.log(`[Search] 所有搜索引擎均未返回结果 (keyword=${keyword})`);
    return [];
  }

  /**
   * 使用 Puppeteer 搜索
   */
  async #searchWithPuppeteer(browser, engine, url) {
    const puppeteer = await import('puppeteer');
    const page = await browser.newPage();
    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector(engine.resultSelector, { timeout: 8000 }).catch(() => {});

      const html = await page.content();
      const $ = cheerio.load(html);
      const results = this.#parseResults($, engine);

      console.log(`[Search] ${engine.name} 返回 ${results.length} 条结果`);
      return results;
    } catch (err) {
      console.error(`[Search] ${engine.name} Puppeteer 失败:`, err.message);
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * 使用 axios 搜索（回退）
   */
  async #searchWithAxios(engine, url) {
    const axios = (await import('axios')).default;
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const results = this.#parseResults($, engine);

      console.log(`[Search] ${engine.name} Axios 返回 ${results.length} 条结果`);
      return results;
    } catch (err) {
      console.error(`[Search] ${engine.name} Axios 失败:`, err.message);
      return [];
    }
  }

  /**
   * 从 cheerio 解析搜索结果
   */
  #parseResults($, engine) {
    const results = [];
    const items = $(engine.resultSelector);

    items.each((_i, el) => {
      try {
        const href = engine.urlResolver($, el);
        if (!engine.hostMatch(href)) return;

        const title = engine.titleResolver($, el);
        const snippet = $(el).text().trim().substring(0, 200);

        if (title || href) {
          results.push({ title: title || '(无标题)', url: href, snippet: snippet || '' });
        }
      } catch (_) { /* skip */ }
    });

    return results;
  }
}

export const googleSearchService = new SearchService();
