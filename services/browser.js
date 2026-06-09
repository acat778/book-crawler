/**
 * 共享的 Puppeteer 浏览器实例管理
 * 用于 Google/Bing 搜索和 69shuba 爬取
 */

/** @type {import('puppeteer').Browser | null} */
let browser = null;

/**
 * 获取或创建 Puppeteer browser 实例
 * @returns {Promise<import('puppeteer').Browser | null>}
 */
export async function getBrowser() {
  if (browser?.isConnected()) return browser;

  try {
    const puppeteer = await import('puppeteer');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--lang=zh-CN',
      ],
    });
    console.log('[Browser] Puppeteer 浏览器已启动');
    return browser;
  } catch (err) {
    console.warn('[Browser] Puppeteer 不可用:', err.message);
    return null;
  }
}

/**
 * 使用 Puppeteer 获取页面 HTML
 * @param {string} url - 页面 URL
 * @param {object} [opts]
 * @param {string} [opts.waitUntil] - 等待策略，默认 'domcontentloaded'
 * @param {number} [opts.timeout] - 超时 ms，默认 20000
 * @param {string} [opts.waitSelector] - 等待特定选择器出现
 * @returns {Promise<string>} 页面 HTML
 */
export async function fetchHtml(url, opts = {}) {
  const { waitUntil = 'domcontentloaded', timeout = 20000, waitSelector = null } = opts;

  const browser = await getBrowser();
  if (!browser) {
    // 回退到 axios
    const axios = await import('axios');
    const resp = await axios.default.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout,
    });
    return resp.data;
  }

  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    });

    await page.goto(url, { waitUntil, timeout });

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 8000 }).catch(() => {});
    }

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}
