import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';

const { googleSearchUrl, baseUrl } = config.crawler;

/**
 * Google 搜索服务 — 在 69shuba.com 站内按关键词搜索书籍
 */
export class GoogleSearchService {

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
      const results = [];

      // Google 搜索结果项（选择器可能因 Google 页面结构变化而需要调整）
      const searchDivs = $('div.g, div[data-sokoban-container]');

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

      console.log(`[GoogleSearch] 返回 ${results.length} 条结果 (keyword=${keyword}, page=${pageNum})`);
      return results;
    } catch (err) {
      console.error('[GoogleSearch] 搜索失败:', err.message);
      // Google 搜索可能因反爬机制失败，返回空结果
      return [];
    }
  }
}

export const googleSearchService = new GoogleSearchService();
