/**
 * 共享的 Puppeteer 浏览器实例管理（puppeteer-extra + stealth 插件）
 * 用于搜索和 69shuba 爬取，绕过 Cloudflare 反爬
 */

/** @type {import('puppeteer').Browser | null} */
let browser = null;
/** @type {boolean} */
let stealthReady = false;

/**
 * 生成随机视口尺寸
 */
function randomViewport() {
  const widths = [1366, 1440, 1536, 1600, 1920];
  const heights = [768, 800, 864, 900, 1080];
  return {
    width: widths[Math.floor(Math.random() * widths.length)],
    height: heights[Math.floor(Math.random() * heights.length)],
  };
}

/**
 * 初始化 puppeteer-extra + stealth 插件
 */
async function initStealth() {
  if (stealthReady) return;
  try {
    const { default: puppeteerExtra } = await import('puppeteer-extra');
    const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());
    // 将 patched puppeteer 挂到全局供后续使用
    globalThis.__puppeteerExtra = puppeteerExtra;
    stealthReady = true;
    console.log('[Browser] puppeteer-extra + stealth 插件已加载');
  } catch (err) {
    console.warn('[Browser] stealth 插件加载失败，使用原生 puppeteer:', err.message);
    stealthReady = false;
  }
}

/**
 * 获取或创建 Puppeteer browser 实例
 * Docker 环境优先使用系统 Chromium，带自动回退
 * @returns {Promise<import('puppeteer').Browser | null>}
 */
export async function getBrowser() {
  if (browser?.isConnected()) return browser;

  try {
    await initStealth();

    // 确定 Chromium 可执行路径
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;
    if (!executablePath) {
      // 自动检测常见路径
      const paths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
      for (const p of paths) {
        try {
          const fs = await import('fs');
          fs.accessSync(p, fs.constants.X_OK);
          executablePath = p;
          break;
        } catch {}
      }
    }

    const launchArgs = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--lang=zh-CN',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    };
    if (executablePath) {
      launchArgs.executablePath = executablePath;
      console.log(`[Browser] 使用 Chromium: ${executablePath}`);
    }

    // 统一使用 puppeteer 的 launch（puppeteer-extra 的 launch 签名兼容）
    let launcher;
    if (globalThis.__puppeteerExtra) {
      launcher = globalThis.__puppeteerExtra;
    } else {
      const puppeteerMod = await import('puppeteer');
      launcher = puppeteerMod.default || puppeteerMod;
    }

    browser = await launcher.launch(launchArgs);
    console.log('[Browser] 浏览器已启动');
    return browser;
  } catch (err) {
    console.warn('[Browser] 浏览器不可用:', err.message);
    return null;
  }
}

/**
 * 为页面注入额外的反检测脚本（作为 stealth 插件的补充）
 */
async function injectExtraStealth(page) {
  await page.evaluateOnNewDocument(() => {
    // 覆盖 navigator 属性
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    // 覆盖 chrome 对象
    if (!window.chrome) window.chrome = { runtime: {} };
  });
}

/**
 * 创建已配置反检测的新页面
 */
export async function newStealthPage(browser) {
  const page = await browser.newPage();

  // 注入额外反检测
  await injectExtraStealth(page);

  // 随机视口
  const viewport = randomViewport();
  await page.setViewport(viewport);

  // 随机 User-Agent
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ];
  await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1',
  });

  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(15000);

  return page;
}

/**
 * 轻量 HTTP 请求（axios），用于搜索等不需要绕过 Cloudflare 的场景
 * 优先于 Puppeteer，更快更省资源
 */
export async function fetchHtmlLight(url, opts = {}) {
  const { timeout = 15000, headers: extraHeaders = {} } = opts;
  try {
    const axios = await import('axios');
    const resp = await axios.default.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        ...extraHeaders,
      },
      timeout,
      // 允许非 200 响应（有些站点搜索返回 4xx 但有 body）
      validateStatus: (s) => s < 500,
    });
    return resp.data;
  } catch (err) {
    console.warn(`[Browser] HTTP 请求失败: ${url} - ${err.message}`);
    return null;
  }
}

/** 返回 HTTP 元数据；调用方需要区分 challenge/受限与真实空响应时使用。 */
export async function fetchHtmlLightWithMeta(url, opts = {}) {
  const { timeout = 15000, headers: extraHeaders = {}, signal } = opts;
  try {
    const axios = await import('axios');
    const resp = await axios.default.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...extraHeaders,
      },
      timeout,
      signal,
      validateStatus: () => true,
    });
    return { status: resp.status, body: typeof resp.data === 'string' ? resp.data : '' };
  } catch (err) {
    if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') throw err;
    return { status: 0, body: '', error: err };
  }
}

/**
 * 使用 Puppeteer 获取页面 HTML（重量级，用于需要 JS 渲染 / Cloudflare 绕过的场景）
 * @param {string} url - 页面 URL
 * @param {object} [opts]
 * @param {string} [opts.waitUntil] - 等待策略，默认 'networkidle2'
 * @param {number} [opts.timeout] - 超时 ms，默认 30000
 * @param {string} [opts.waitSelector] - 等待特定选择器出现
 * @returns {Promise<string>} 页面 HTML
 */
export async function fetchHtml(url, opts = {}) {
  const { waitUntil = 'networkidle2', timeout = 30000, waitSelector = null,
          method = 'GET', body = null, headers: extraHeaders = {} } = opts;

  const br = await getBrowser();
  if (!br) {
    // 浏览器不可用时回退 axios
    return fetchHtmlLight(url, { timeout, headers: extraHeaders });
  }

  const page = await newStealthPage(br);
  try {
    // 支持 POST 请求：拦截导航请求并修改
    if (method === 'POST' && body) {
      await page.setRequestInterception(true);
      page.once('request', (req) => {
        req.continue({
          method: 'POST',
          postData: typeof body === 'string' ? body : new URLSearchParams(body).toString(),
          headers: {
            ...req.headers(),
            'Content-Type': 'application/x-www-form-urlencoded',
            ...extraHeaders,
          },
        });
      });
    }

    await page.goto(url, { waitUntil, timeout });

    // 关闭请求拦截（如果开启了）
    if (method === 'POST') {
      await page.setRequestInterception(false);
    }

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {
        console.warn(`[Browser] 等待选择器超时: ${waitSelector}`);
      });
    }

    // 等待额外渲染
    await new Promise(r => setTimeout(r, 1000));

    return await page.content();
  } catch (err) {
    console.warn(`[Browser] 页面加载失败: ${url} - ${err.message}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 获取页面对象（用于需要交互的场景，如点击展开按钮）
 */
export async function openPage(url, opts = {}) {
  const { waitUntil = 'networkidle2', timeout = 30000, waitSelector = null } = opts;

  const br = await getBrowser();
  if (!br) return null;

  const page = await newStealthPage(br);
  try {
    await page.goto(url, { waitUntil, timeout });

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 500));
    return { page, browser: br };
  } catch (err) {
    console.warn(`[Browser] 打开页面失败: ${url} - ${err.message}`);
    await page.close().catch(() => {});
    return null;
  }
}
