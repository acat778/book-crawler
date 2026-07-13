import * as cheerio from 'cheerio';
import config from '../config.js';
import { fetchHtml, fetchHtmlLight, fetchHtmlLightWithMeta } from '../services/browser.js';
import { SiteAdapter } from './SiteAdapter.js';

const BASE_URL = 'https://www.69shuba.com';

/**
 * 69shuba 站点适配器
 *
 * 69shuba 特点：
 * - 书籍页 URL: /book/{id}.htm
 * - 章节 URL: /txt/{bookId}/{chapterId}
 * - 目录选择器: #catalog ul li（带 data-num 属性）
 * - 正文容器: #htmlContent, #chaptercontent 等
 * - 无站内搜索，使用 DuckDuckGo site: 搜索 + 分类页浏览
 */
export class Site69shuba extends SiteAdapter {

  get id() { return '69shuba'; }
  get displayName() { return '69书吧'; }
  get baseUrl() { return BASE_URL; }

  // ==================== URL 模式 ====================

  extractBookId(url) {
    const m = url.match(/\/book\/(\d+)/);
    return m ? m[1] : null;
  }

  buildCatalogUrl(bookId) {
    return `${BASE_URL}/book/${bookId}/`;
  }

  normalizeBookUrl(url) {
    try {
      const parsed = new URL(url);
      let path = parsed.pathname.replace(/\/$/, '');
      if (!path.endsWith('.htm')) path += '.htm';
      return parsed.origin + path;
    } catch {
      return url;
    }
  }

  isBookUrl(url) {
    try {
      const parsed = new URL(url);
      return /\/book\/\d+/.test(parsed.pathname);
    } catch {
      return /\/book\/\d+/.test(url);
    }
  }

  getCatalogWaitSelector() {
    return '#catalog, .catalog, ul.chapterlist';
  }

  getDefaultCover() {
    return 'https://static.69shuba.com/images/nocover.jpg';
  }

  getBookDetailWaitSelector() {
    return 'h1, meta[property="og:title"]';
  }

  // ==================== Puppeteer 交互 ====================

  async beforeParseBookDetail(page) {
    // 点击"展开"链接以获取完整介绍
    const expandClicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const expandLink = links.find(a =>
        a.textContent?.includes('展开') ||
        a.textContent?.includes('更多') ||
        a.textContent?.includes('显示全部')
      );
      if (expandLink) {
        expandLink.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (expandClicked) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // ==================== 书籍元数据解析 ====================

  parseBookMeta($, html, bookUrl) {
    // 从 meta 标签提取（最可靠）
    let title = this._metaTag($, 'og:title') || '';
    let authorName = this._metaTag($, 'og:novel:author') || '';
    let categoryName = this._metaTag($, 'og:novel:category') || '';
    let statusText = this._metaTag($, 'og:novel:status') || '';
    let introduction = this._metaTag($, 'og:description') || '';

    // fallback title
    if (!title) {
      title = $('h1').first().text().trim() || $('h1 a').first().text().trim();
    }

    if (!title) {
      return { success: false, message: '无法提取书籍标题' };
    }

    // fallback author
    if (!authorName) {
      $('p').each((_i, el) => {
        const text = $(el).text();
        if (text.includes('作者') || text.includes('著')) {
          const a = $(el).find('a').first();
          if (a.length) {
            authorName = a.text().trim();
            return false;
          }
        }
      });
    }

    // fallback category
    if (!categoryName) {
      $('p a[href*="/novels/class/"]').each((_i, el) => {
        const text = $(el).text().trim();
        if (text && text.length < 10) {
          categoryName = text;
          return false;
        }
      });
    }

    // fallback status
    if (!statusText) {
      $('p').each((_i, el) => {
        const text = $(el).text();
        if (text.includes('状态') || text.includes('连载') || text.includes('完结') || text.includes('完本')) {
          statusText = text.replace('状态：', '').trim();
          if (statusText.length > 10) {
            if (statusText.includes('连载')) statusText = '连载中';
            else if (statusText.includes('完结') || statusText.includes('完本')) statusText = '已完结';
          }
          return false;
        }
      });
    }

    // 提取封面
    let coverUrl = this._metaTag($, 'og:image');
    if (!coverUrl || coverUrl.includes('nocover')) {
      $('img').each((_i, el) => {
        const src = $(el).attr('src') || '';
        if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
          if (src.includes('/book/') || src.includes('/images/') || src.includes('/cover/')) {
            coverUrl = src;
            if (coverUrl.startsWith('/')) coverUrl = BASE_URL + coverUrl;
            else if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
            return false;
          }
        }
      });
    }
    if (!coverUrl || coverUrl === BASE_URL + '/images/nocover.jpg' || coverUrl.includes('nocover')) {
      coverUrl = this.getDefaultCover();
    }
    if (coverUrl && coverUrl.startsWith('/')) coverUrl = BASE_URL + coverUrl;
    if (coverUrl && coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;

    // 提取标签
    const tags = [];
    $('ul li a[href*="/novels/class/"]').each((_i, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 20 && !tags.includes(text)) {
        tags.push(text);
      }
    });
    if (tags.length === 0) {
      $('a[href*="/novels/"]').each((_i, el) => {
        const text = $(el).text().trim();
        if (text && text.length < 15 && !tags.includes(text) && !text.includes('http')) {
          tags.push(text);
        }
      });
    }

    // fallback 介绍
    if (!introduction || introduction.length < 50) {
      const descSelectors = [
        'div.intro', 'div.description', 'div.book-intro',
        'div[class*="intro"]', 'div[class*="desc"]',
        '#intro', '#description',
      ];
      for (const sel of descSelectors) {
        const el = $(sel);
        if (el.length) {
          const text = el.text().trim().replace(/\s+/g, ' ');
          if (text.length > introduction.length) {
            introduction = text;
          }
        }
      }
    }

    introduction = introduction.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

    console.log(`[69shuba] 解析结果: title="${title}", author="${authorName}", category="${categoryName}", status="${statusText}", tags=[${tags.join(',')}], introLen=${introduction.length}, cover=${coverUrl ? 'yes' : 'no'}`);

    return {
      success: true,
      title: title.replace(/\s+/g, ' ').trim(),
      authorName,
      categoryName,
      introduction,
      statusText,
      coverUrl,
      tags,
    };
  }

  // ==================== 章节列表解析 ====================

  parseChapterLinks($) {
    const chapterLinks = [];

    // 优先匹配 #catalog ul li（标准结构）
    $('#catalog ul li').each((_i, el) => {
      const $li = $(el);
      const $a = $li.find('a').first();
      const href = $a.attr('href') || '';
      const title = $a.text().trim();

      let dataNum = $li.attr('data-num');
      if (!dataNum) {
        dataNum = $li.attr('data-index') || $li.attr('data-chapter');
      }

      if (href && title) {
        chapterLinks.push({
          title,
          url: href.startsWith('http') ? href : BASE_URL + href,
          sortOrder: dataNum ? parseInt(dataNum, 10) : _i + 1,
        });
      }
    });

    // fallback: ul li a 包含 /txt/
    if (chapterLinks.length === 0) {
      $('ul li a[href*="/txt/"]').each((_i, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const title = $a.text().trim();
        if (href && title) {
          chapterLinks.push({
            title,
            url: href.startsWith('http') ? href : BASE_URL + href,
            sortOrder: _i + 1,
          });
        }
      });
    }

    // fallback: .chapterlist / .catalog / ul.list
    if (chapterLinks.length === 0) {
      $('.chapterlist a, .catalog a, ul.list a').each((_i, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const title = $a.text().trim();
        if (href && title) {
          chapterLinks.push({
            title,
            url: href.startsWith('http') ? href : BASE_URL + href,
            sortOrder: _i + 1,
          });
        }
      });
    }

    return chapterLinks;
  }

  // ==================== 章节正文提取 ====================

  extractChapterParagraphs($) {
    // 移除明确的非内容元素
    $('script, style, noscript, iframe, ins').remove();
    // 广告相关（注意：不能用 [class*="ad-"]，会误杀 read-content）
    $('.ads, [class*="advert"], [class*="ad_banner"], [id*="advert"]').remove();
    $('#pageheadermenu, .headuser, .menu_close_btn, header, nav, footer').remove();

    let contentText = '';

    // 策略1: 尝试匹配已知内容选择器
    const contentSelectors = [
      '#htmlContent', '#chaptercontent', '.chapter-content',
      '#content', '.content', '#chapter-container',
      'article', '.novel-content', '.book-content',
      '.la_content', '#BookText', '#booktext',
    ];

    for (const sel of contentSelectors) {
      const el = $(sel);
      if (el.length) {
        contentText = el.first().text();
        if (contentText.trim().length > 100) break;
        contentText = '';
      }
    }

    // 策略2: 从 body 提取，按行找到正文起始位置
    if (!contentText) {
      const bodyText = $('body').text();
      const lines = bodyText.split('\n');

      let startLine = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^第[一二三四五六七八九十百千\d]+[章节回]/.test(line) ||
            /^Chapter\s*\d+/i.test(line) ||
            /^\s*第[一二三四五六七八九十百千\d]+[章节回]/.test(line)) {
          startLine = i;
          break;
        }
      }

      if (startLine === 0) {
        const navKeywords = ['首页', '排行', '分类', '书架', '阅读记录', '登录', '注册',
          '忘记密码', '简体', '繁體', 'loadAdv', '69书吧', '男生小说', '女生小说',
          '完本小说', '小说分类', '我的书架', '最近阅读'];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const isNav = navKeywords.some(kw => line.includes(kw));
          if (!isNav && line.length > 10) {
            startLine = i;
            break;
          }
        }
      }

      contentText = lines.slice(startLine).join('\n');
    }

    if (!contentText || contentText.trim().length < 20) return [];

    // 清理页眉页脚
    let text = contentText;

    const bmIdx = text.indexOf('加入书架');
    if (bmIdx >= 0 && bmIdx < 200) {
      text = text.substring(bmIdx + 4);
    }

    const bm2Idx = text.indexOf('书签');
    if (bm2Idx >= 0 && bm2Idx < 50) {
      text = text.substring(bm2Idx + 2);
    }

    const headerCleanups = ['注册登录忘记密码', 'loadAdv(', '首页 >'];
    for (const h of headerCleanups) {
      while (text.startsWith(h) || text.trimStart().startsWith(h)) {
        const nl = text.indexOf('\n');
        text = nl >= 0 ? text.substring(nl + 1) : '';
      }
    }

    const footerMarkers = [
      '上一章', '下一章', '返回目录', '加入书签',
      '本章未完', '点击下一页', '本章完',
      '最快更新', '请收藏本站', '-->>', 'PS:', 'ps:',
      '推荐本书', '手机用户请浏览',
    ];
    for (const marker of footerMarkers) {
      const idx = text.lastIndexOf(marker);
      if (idx > text.length * 0.7) {
        text = text.substring(0, idx);
      }
    }

    // 按双换行分段
    const rawParts = text.split(/\n\s*\n/);
    let paragraphs = rawParts
      .map(p => p.trim())
      .filter(p => {
        if (p.length < 2) return false;
        if (/^(首页|排行榜|男生|女生|完本|分类|书架|阅读|登录|注册|简体|繁體|loadAdv|首页\s*\n)/.test(p)) return false;
        if (/^\d{4}-\d{2}-\d{2}\s*作者/.test(p)) return false;
        return true;
      });

    if (paragraphs.length === 0) return [];

    // 移除第一段中的章节标题行
    if (paragraphs.length >= 1) {
      const firstLines = paragraphs[0].split('\n');
      if (firstLines.length > 1 && /^第[一二三四五六七八九十百千\d]+[章节回]/.test(firstLines[0].trim())) {
        paragraphs[0] = firstLines.slice(1).join('\n').trim();
        if (!paragraphs[0]) paragraphs.shift();
      }
    }

    while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].length < 5) {
      paragraphs.pop();
    }

    return paragraphs.filter(p => p.length > 1);
  }

  // ==================== 搜索 ====================

  async search(keyword, pageNum = 0) {
    const deadline = Date.now() + 12000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const query = `site:69shuba.com ${keyword}`;
    const offset = pageNum * 30;
    const urls = [
      ['site_69shuba', BASE_URL],
      ['duckduckgo_html', `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}`],
      ['duckduckgo_lite', `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&s=${offset}`],
    ];
    try {
      const settled = await Promise.all(urls.map(async ([source, url]) => {
        const remaining = Math.max(1, deadline - Date.now());
        const response = await fetchHtmlLightWithMeta(url, { timeout: remaining, signal: controller.signal });
        if (response.status === 403) return { source, failure: { source, category: 'site_restricted' } };
        if (response.status === 202 || /just a moment|challenge|captcha/i.test(response.body)) return { source, failure: { source, category: 'challenge' } };
        if (!response.status || response.status >= 500) return { source, failure: { source, category: response.error ? 'timeout' : 'abnormal_response' } };
        if (source === 'site_69shuba') return { source, failure: { source, category: 'abnormal_response' } };
        const parsed = this.#parseDdgResponse(response.body);
        return { source, ...parsed, outcome: parsed.results.length ? 'results' : 'empty' };
      }));
      const successes = settled.filter((item) => item.outcome === 'results');
      const results = [];
      const seen = new Set();
      for (const item of successes.sort((a, b) => urls.findIndex(([s]) => s === a.source) - urls.findIndex(([s]) => s === b.source))) {
        for (const result of item.results) if (!seen.has(result.url)) { seen.add(result.url); results.push(result); }
      }
      if (results.length) return { outcome: 'results', results: results.slice(0, 30), hasMore: successes.some((item) => item.hasMore), failures: [] };
      const failures = settled.filter((item) => item.failure).map((item) => item.failure);
      return failures.length === settled.length
        ? { outcome: 'unavailable', results: [], hasMore: false, failures }
        : { outcome: 'empty', results: [], hasMore: false, failures: [] };
    } catch (err) {
      return { outcome: 'unavailable', results: [], hasMore: false, failures: [{ source: 'duckduckgo_html', category: err.name === 'AbortError' ? 'timeout' : 'abnormal_response' }] };
    } finally { clearTimeout(timer); }
  }

  #parseDdgResponse(html) {
    try {
      const $ = cheerio.load(html);
      const results = this.#parseDdgResults($);
      const hasMore = this.#extractDdgHasMore($, results.length);
      return { results: results.slice(0, 30), hasMore };
    } catch (err) {
      console.warn(`[Search] DuckDuckGo 解析失败: ${err.message}`);
      return { results: [], hasMore: false, failure: { source: 'DuckDuckGo HTML', category: 'abnormal_response' } };
    }
  }

  #parseDdgResults($) {
    const results = [];
    const seen = new Set();

    $('a.result__a[href*="69shuba.com"]').each((_i, el) => {
      const $el = $(el);
      const ddgHref = $el.attr('href') || '';

      let targetUrl = '';
      try {
        const urlObj = new URL(ddgHref, 'https://html.duckduckgo.com');
        const uddg = urlObj.searchParams.get('uddg');
        if (uddg) {
          targetUrl = decodeURIComponent(uddg);
        }
      } catch {
        const m = ddgHref.match(/uddg=([^&]+)/);
        if (m) {
          try { targetUrl = decodeURIComponent(m[1]); } catch {}
        }
      }

      if (!targetUrl || !this.isBookUrl(targetUrl)) return;
      targetUrl = this.normalizeBookUrl(targetUrl);
      if (!targetUrl || seen.has(targetUrl)) return;
      seen.add(targetUrl);

      let title = $el.text().trim();
      title = title
        .replace(/最新章节列表.*$/, '')
        .replace(/无弹窗.*$/, '')
        .replace(/最新章节阅读.*$/, '')
        .replace(/全文阅读.*$/, '')
        .replace(/txt全集下载.*$/, '')
        .replace(/-69书吧.*$/, '')
        .replace(/69书吧.*$/, '')
        .trim();

      let snippet = '';
      const $parent = $el.closest('td, div');
      if ($parent.length) {
        const $snippet = $parent.find('a.result__snippet').first();
        if ($snippet.length) {
          snippet = $snippet.text().trim().substring(0, 300);
        }
      }

      if (title && title.length > 1) {
        results.push({
          title: title.replace(/\s+/g, ' ').trim(),
          url: targetUrl,
          snippet,
        });
      }
    });

    // fallback 宽松匹配
    if (results.length === 0) {
      $('a[href*="69shuba.com"]').each((_i, el) => {
        const $el = $(el);
        const href = $el.attr('href') || '';

        let targetUrl = '';
        const m = href.match(/uddg=([^&]+)/);
        if (m) {
          try { targetUrl = decodeURIComponent(m[1]); } catch {}
        } else if (href.startsWith('http') && href.includes('69shuba.com/book/')) {
          targetUrl = href;
        }

        if (!targetUrl || !this.isBookUrl(targetUrl)) return;
        targetUrl = this.normalizeBookUrl(targetUrl);
        if (!targetUrl || seen.has(targetUrl)) return;
        seen.add(targetUrl);

        let title = $el.text().trim()
          .replace(/最新章节列表.*$/, '')
          .replace(/-69书吧.*$/, '')
          .replace(/69书吧.*$/, '')
          .trim();

        if (title && title.length > 1) {
          results.push({
            title: title.replace(/\s+/g, ' ').trim(),
            url: targetUrl,
            snippet: '',
          });
        }
      });
    }

    console.log(`[Search] DuckDuckGo 解析到 ${results.length} 条 69shuba 书籍`);
    return results.slice(0, 30);
  }

  /**
   * 从 DuckDuckGo HTML 搜索结果页检测是否有更多结果
   * @param {import('cheerio').CheerioAPI} $ - cheerio 实例
   * @param {number} resultCount - 当前页解析到的结果数
   * @returns {boolean}
   */
  #extractDdgHasMore($, resultCount) {
    // Signal 1: DDG "More Results" form — 最可靠的信号，DDG 只在有更多结果时渲染
    if ($('form.results--more').length > 0) return true;

    // Signal 2: 语义化 next 链接
    if ($('a[rel="next"]').length > 0) return true;

    // Signal 3: form 中包含 s= 参数（DDG legacy 分页）
    let hasMoreFromForm = false;
    $('form[action*="/html/"] input[name="s"]').each((_i, el) => {
      const val = parseInt($(el).attr('value') || '0', 10);
      if (val > 0) hasMoreFromForm = true;
    });
    if (hasMoreFromForm) return true;

    // Signal 4: 包含 "Next" / "More" 文本的导航链接
    const navTexts = $('.nav-link, .result--more__btn, a.result--more-link').text();
    if (navTexts.includes('Next') || navTexts.includes('More')) return true;

    // Fallback: 不足 30 条 → 最后一页
    if (resultCount < 30) return false;

    // 保守回退：量足但无明确信号，假设可能还有
    return true;
  }

  // ==================== 分类浏览 ====================

  async #browseCategory(keyword) {
    const categoryUrls = [
      `${BASE_URL}/novels/class/0.htm`,
      `${BASE_URL}/novels/full`,
      `${BASE_URL}/novels/hot`,
      `${BASE_URL}/last.html`,
    ];

    for (const url of categoryUrls) {
      try {
        console.log(`[Search] 浏览分类页: ${url}`);
        let html = await fetchHtmlLight(url, { timeout: 15000 });
        if (!html || html.length < 1000) {
          html = await fetchHtml(url, {
            waitUntil: 'networkidle2',
            timeout: 30000,
            waitSelector: 'h3 a, a[href*="/book/"]',
          });
        }
        if (!html) continue;

        const $ = cheerio.load(html);
        const results = [];
        const seenUrls = new Set();

        $('h3 a[href*="/book/"]').each((_i, el) => {
          const $el = $(el);
          const href = $el.attr('href') || '';
          const title = $el.text().trim();
          if (!title || seenUrls.has(href)) return;
          seenUrls.add(href);

          if (this.#matchKeyword(title, keyword)) {
            const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
            results.push({ title, url: fullUrl, snippet: '' });
          }
        });

        $('a[href*="/book/"]').each((_i, el) => {
          const $el = $(el);
          const href = $el.attr('href') || '';
          const title = $el.text().trim();
          if (!title || seenUrls.has(href)) return;
          if (title.length < 2 || title === '点击阅读' || title === '查看详情') return;
          seenUrls.add(href);

          if (this.#matchKeyword(title, keyword)) {
            const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
            results.push({ title, url: fullUrl, snippet: '' });
          }
        });

        if (results.length > 0) {
          console.log(`[Search] 分类页返回 ${results.length} 条匹配结果 (keyword=${keyword})`);
          return { results: results.slice(0, 20), hasMore: false };
        }
      } catch (err) {
        console.warn(`[Search] 分类页失败: ${url} - ${err.message}`);
      }
    }

    return { results: [], hasMore: false, failure: { source: '69书吧', category: 'abnormal_response' } };
  }

  #matchKeyword(title, keyword) {
    return title.toLowerCase().includes(keyword.toLowerCase());
  }
}
