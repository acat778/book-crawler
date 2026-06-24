import * as cheerio from 'cheerio';
import { fetchHtml, fetchHtmlLight } from '../services/browser.js';
import { SiteAdapter } from './SiteAdapter.js';

const BASE_URL = 'https://www.alicesw.com';

/**
 * alicesw (爱丽丝书屋) 站点适配器
 *
 * 特点：
 * - 书籍页 URL: /novel/{id}.html
 * - 章节 URL: /book/{bookId}/{hash}.html
 * - 章节目录在书籍详情页内嵌（也有独立页 /other/chapters/id/{id}.html）
 * - 站内搜索: /search.html?q=...&p=N
 * - OG meta 标签 + 页面结构混合解析
 * - 正文容器: #chaptercontent, #content, .content 等
 */
export class SiteAlicesw extends SiteAdapter {

  get id() { return 'alicesw'; }
  get displayName() { return '爱丽丝书屋'; }
  get baseUrl() { return BASE_URL; }

  /** 爱丽丝书屋默认为 18 禁 */
  get isAdult() { return 1; }

  // ==================== URL 模式 ====================

  extractBookId(url) {
    const m = url.match(/\/novel\/(\d+)/);
    return m ? m[1] : null;
  }

  buildCatalogUrl(bookId) {
    // 使用独立章节列表页（"查看所有章节" 跳转的目标）
    return `${BASE_URL}/other/chapters/id/${bookId}.html`;
  }

  normalizeBookUrl(url) {
    try {
      const parsed = new URL(url);
      let path = parsed.pathname.replace(/\/$/, '');
      if (!path.endsWith('.html')) path += '.html';
      return parsed.origin + path;
    } catch {
      return url;
    }
  }

  isBookUrl(url) {
    try {
      const parsed = new URL(url);
      return /\/novel\/\d+/.test(parsed.pathname);
    } catch {
      return /\/novel\/\d+/.test(url);
    }
  }

  getCatalogWaitSelector() {
    // 独立章节列表页的章节链接
    return 'li a[href*="/book/"], a[href*="/book/"]';
  }

  getDefaultCover() {
    return `${BASE_URL}/template/home/diyquge/images/nocover.jpg`;
  }

  getBookDetailWaitSelector() {
    return 'a[href*="/book/"], meta[property="og:title"]';
  }

  // ==================== Puppeteer 交互 ====================

  async beforeParseBookDetail(page) {
    // alicesw 通常不需要特殊交互，简介直接可见
    // 但有时需要滚动触发懒加载的章节列表
    try {
      await page.evaluate(() => {
        // 滚动到章节列表区域
        const chapterSection = document.querySelector('a[href*="/book/"]');
        if (chapterSection) {
          chapterSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      await new Promise(r => setTimeout(r, 800));
    } catch { /* ignore */ }
  }

  // ==================== 书籍元数据解析 ====================

  parseBookMeta($, html, bookUrl) {
    // OG meta 标签
    let title = this._metaTag($, 'og:title') || '';
    let authorName = this._metaTag($, 'og:novel:author') || '';
    let categoryName = this._metaTag($, 'og:novel:category') || '';
    let statusText = this._metaTag($, 'og:novel:status') || '';
    let introduction = this._metaTag($, 'og:description') || '';

    // fallback title: from <title> or page heading
    if (!title) {
      title = $('title').text().trim();
      title = title.replace(/\s*[-–—|]\s*爱丽丝书屋.*$/i, '')
        .replace(/\s*[-–—|]\s*ALICESW.*$/i, '')
        .replace(/_爱丽丝书屋.*$/, '')
        .trim();
    }
    // 清理 OG title 中的分类后缀（如 "斗罗大陆:至阳龙根-同人"）
    title = title.replace(/-[^\s]{1,8}$/, '').trim();
    if (!title) {
      title = $('h1').first().text().trim();
    }

    if (!title) {
      return { success: false, message: '无法提取书籍标题' };
    }

    // fallback author: a[href*="f=author"]
    if (!authorName) {
      const $authorLink = $('a[href*="f=author"]').first();
      authorName = $authorLink.text().trim();
    }
    if (!authorName) {
      // 查找 text "作者" 或 "作 者" 附近的链接
      $('p, div, span').each((_i, el) => {
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

    // fallback category: 优先级 — 面包屑中的分类链接
    // 站点有多套模板，面包屑类名可能为 .crumbs-nav 或 .bread-crumb-nav
    if (!categoryName) {
      const breadcrumbLists = $(
        '.crumbs-nav a[href^="/lists/"], ' +
        '.bread-crumbs a[href^="/lists/"], ' +
        '.bread-crumb-nav a[href^="/lists/"]'
      );
      if (breadcrumbLists.length > 0) {
        categoryName = breadcrumbLists.last().text().trim();
      }
    }
    // OG meta 作为后备
    if (!categoryName) {
      categoryName = this._metaTag($, 'og:novel:category') || '';
    }
    // 最后尝试页面其他 /lists/ 链接
    if (!categoryName) {
      categoryName = $('a[href^="/lists/"]').first().text().trim();
    }

    // fallback status
    if (!statusText) {
      const fullText = $('body').text();
      if (fullText.includes('连载中')) statusText = '连载中';
      else if (fullText.includes('已完结')) statusText = '已完结';
    }

    // 提取封面
    let coverUrl = this._metaTag($, 'og:image');
    if (!coverUrl) {
      // 查找 cdn 图片
      const $coverImg = $('img[src*="img.321cdn.com"], img[src*="uploads"]').first();
      if ($coverImg.length) {
        coverUrl = $coverImg.attr('src') || '';
      }
    }
    if (!coverUrl) {
      // 查找任意疑似封面的 img
      $('img').each((_i, el) => {
        const src = $(el).attr('src') || '';
        if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')
          && !src.includes('caret') && !src.includes('template')) {
          coverUrl = src;
          return false;
        }
      });
    }
    // 确保绝对 URL
    if (coverUrl && coverUrl.startsWith('/')) coverUrl = BASE_URL + coverUrl;
    if (coverUrl && coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
    if (!coverUrl) coverUrl = this.getDefaultCover();

    // 提取标签: a[href*="f=tag"]
    const tags = [];
    $('a[href*="f=tag"]').each((_i, el) => {
      const text = $(el).text().trim().replace(/^#/, '').trim();
      if (text && text.length < 20 && !tags.includes(text)) {
        tags.push(text);
      }
    });
    // 也检查 /search?q=...&f=tag 变体
    $('a[href*="search"][href*="f=tag"]').each((_i, el) => {
      const text = $(el).text().trim().replace(/^#/, '').trim();
      if (text && text.length < 20 && !tags.includes(text)) {
        tags.push(text);
      }
    });

    // fallback 介绍
    if (!introduction || introduction.length < 50) {
      const descSelectors = [
        '.intro', '.description', '.book-intro', '.book-desc',
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
    // 清理 HTML
    introduction = introduction.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

    console.log(`[alicesw] 解析结果: title="${title}", author="${authorName}", category="${categoryName}", status="${statusText}", tags=[${tags.join(',')}], introLen=${introduction.length}, cover=${coverUrl ? 'yes' : 'no'}`);

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

    // 策略1: 书籍页嵌的章节链接 a[href*="/book/BOOKID/"]
    // 提取 bookId 从已有链接
    const firstChapterLink = $('a[href*="/book/"]').first().attr('href') || '';
    const bookIdMatch = firstChapterLink.match(/\/book\/(\d+)\//);
    const bookIdInLinks = bookIdMatch ? bookIdMatch[1] : null;

    const seenUrls = new Set();

    // 匹配章节链接: /book/{id}/{hash}.html
    // 优先从 li > a 结构提取（全文列表页使用此结构）
    const linkSelector = 'li a[href*="/book/"], a[href*="/book/"]';

    $(linkSelector).each((_i, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      const title = $a.text().trim();

      // 过滤非章节链接
      if (!href || !title) return;
      if (!/\/book\/\d+\/[a-f0-9]+\.html$/i.test(href)) return;
      if (title.length < 2 || title.length > 200) return;
      // 跳过非章节的导航链接
      if (title.includes('章节目录') || title.includes('返回书页') ||
          title.includes('查看全部') || title.includes('查看所有') ||
          title.includes('上一章') || title.includes('下一章') ||
          title === '开始阅读' || title === '继续阅读') return;

      const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
      if (seenUrls.has(fullUrl)) return;
      seenUrls.add(fullUrl);

      chapterLinks.push({
        title,
        url: fullUrl,
        sortOrder: chapterLinks.length + 1,
      });
    });

    // 策略2: 独立目录页（/other/chapters/id/{id}.html）的 ul/li 结构
    if (chapterLinks.length === 0) {
      $('ul li a, ol li a, dl dd a').each((_i, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const title = $a.text().trim();
        if (!href || !title) return;
        if (title.length < 2 || title.length > 200) return;

        const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
        chapterLinks.push({
          title,
          url: fullUrl,
          sortOrder: _i + 1,
        });
      });
    }

    // 策略3: 通用链接提取（去重）
    if (chapterLinks.length === 0) {
      const seen = new Set();
      $('a').each((_i, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const title = $a.text().trim();
        if (!href || !title) return;
        if (title.length < 2 || title.length > 200) return;
        // 章节标题特征：以"第X章"开头
        if (!/^第[一二三四五六七八九十百千\d]+[章节卷回]/.test(title)) return;
        if (seen.has(href)) return;
        seen.add(href);

        const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
        chapterLinks.push({
          title,
          url: fullUrl,
          sortOrder: _i + 1,
        });
      });
    }

    return chapterLinks;
  }

  // ==================== 章节正文提取 ====================

  extractChapterParagraphs($) {
    // 移除非内容元素（必须在查找内容容器之前执行）
    $('script, style, noscript, iframe, ins').remove();
    // 广告相关（注意：不能用 [class*="ad-"]，会误杀 read-content）
    $('.ads, [class*="advert"], [class*="ad_banner"], [id*="advert"]').remove();
    $('header, nav, footer, .header, .nav, .footer, .breadcrumb').remove();
    // alicesw 侧边栏浮层（目录/设置/手机/书架/书页/简体/投票/反馈/评论）
    $('.float-wrap, .fix-float-wrap, #j_floatWrap, #j_leftBarList, #j_rightBarList').remove();
    // 导航头
    $('.read-header, .crumbs-nav, .chapter-control').remove();
    // 隐藏面板
    $('.panel-wrap, .reader-toolbar, .settings-panel, .chapter-dir, .mobile-reader, .action-bar').remove();

    let contentText = '';
    let paragraphs = [];

    // 策略1: alicesw 专用 — .read-content / .j_readContent 内的 <p>
    const contentSelectors = [
      '.read-content', '.j_readContent', '.user_ad_content',
      '#chaptercontent', '#chapter-content', '#chapterContent',
      '#htmlContent', '#content', '.content', '.chapter-content',
      '.chapter-body', '.novel-content', '.book-content',
      '#BookText', '#booktext', 'article',
    ];

    for (const sel of contentSelectors) {
      const el = $(sel);
      if (el.length) {
        // 优先提取 <p> 标签
        const pTags = el.find('p');
        if (pTags.length > 0) {
          paragraphs = pTags.map((_i, p) => $(p).text().trim()).get()
            .filter(t => t.length > 0);
          if (paragraphs.length > 0) {
            console.log(`[alicesw] 从 ${sel} > p 提取到 ${paragraphs.length} 段`);
            return paragraphs;
          }
        }
        // fallback: 整个容器的文本
        contentText = el.first().text();
        if (contentText.trim().length > 50) break;
        contentText = '';
      }
    }

    // 策略2: 从 body 提取，按行找章节标题起始
    if (!contentText) {
      // 先移除更多非内容区域
      $('.read-header, #readHeader, .crumbs-nav, .chapter-control').remove();
      $('.float-wrap, #j_floatWrap, .left-bar-list, .right-bar-list').remove();

      const bodyText = $('body').text();
      const lines = bodyText.split('\n');

      let startLine = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^第[一二三四五六七八九十百千\d]+[章节卷回]/.test(line) ||
            /^Chapter\s*\d+/i.test(line)) {
          startLine = i;
          break;
        }
      }

      if (startLine === 0) {
        const navKeywords = ['首页', '排行', '分类', '书架', '登录', '注册',
          '简体', '繁體', '爱丽丝书屋', 'alicesw', '男生', '女生',
          '完本', '最新', '热门', '推荐', '搜索',
          '目录', '设置', '手机', '书页', '投票', '反馈', '评论'];
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

    let text = contentText;

    // 清理页脚
    const footerMarkers = [
      '上一章', '下一章', '返回目录', '返回书页', '加入书架',
      '本章未完', '点击下一页', '本章完', '推荐本书',
      '手机用户请浏览', '喜欢本书请收藏', '温馨提示',
      '最快更新', '请收藏本站', '-->>', 'PS：', 'ps：',
    ];
    for (const marker of footerMarkers) {
      const idx = text.lastIndexOf(marker);
      if (idx > text.length * 0.7) {
        text = text.substring(0, idx);
      }
    }

    // 按双换行分段
    const rawParts = text.split(/\n\s*\n/);
    paragraphs = rawParts
      .map(p => p.trim())
      .filter(p => {
        if (p.length < 2) return false;
        if (/^(首页|排行榜|男生|女生|完本|分类|书架|阅读|登录|注册|简体|繁體|搜索|排行)/.test(p)) return false;
        if (/^\d{4}-\d{2}-\d{2}\s*作者/.test(p)) return false;
        return true;
      });

    if (paragraphs.length === 0) return [];

    // 移除第一段中的章节标题行
    if (paragraphs.length >= 1) {
      const firstLines = paragraphs[0].split('\n');
      if (firstLines.length > 1 && /^第[一二三四五六七八九十百千\d]+[章节卷回]/.test(firstLines[0].trim())) {
        paragraphs[0] = firstLines.slice(1).join('\n').trim();
        if (!paragraphs[0]) paragraphs.shift();
      }
    }

    while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].length < 5) {
      paragraphs.pop();
    }

    return paragraphs.filter(p => p.length > 1);
  }

  // ==================== 站内搜索 ====================

  async search(keyword, pageNum = 0) {
    const page = pageNum + 1; // alicesw 页码从 1 开始
    const url = `${BASE_URL}/search.html?q=${encodeURIComponent(keyword)}&f=_all&sort=relevance&p=${page}&serialize=`;

    console.log(`[Search] alicesw 站内搜索: q=${keyword} p=${page}`);

    // 策略1: 轻量 HTTP（快，不触发 Cloudflare）
    let html = await fetchHtmlLight(url, { timeout: 20000 });
    if (html && html.length > 1000) {
      const result = this.#parseAndReturn(html, page);
      if (result.results.length > 0) {
        console.log(`[Search] alicesw HTTP 返回 ${result.results.length} 条结果`);
        return result;
      }
    }

    // 策略2: Puppeteer 浏览器（重，但可绕过 Cloudflare）
    console.log(`[Search] alicesw HTTP 无结果，回退 Puppeteer`);
    html = await fetchHtml(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
      waitSelector: 'a[href^="/novel/"]',
    });
    if (!html) {
      console.warn(`[Search] alicesw Puppeteer 也失败`);
      return { results: [], hasMore: false };
    }

    return this.#parseAndReturn(html, page);
  }

  #parseAndReturn(html, page) {
    try {
      const $ = cheerio.load(html);
      const results = this.#parseSearchResults($);
      const hasMore = this.#extractAliceswHasMore($, page, results.length);
      return { results: results.slice(0, 30), hasMore };
    } catch (err) {
      console.warn(`[Search] alicesw 解析失败: ${err.message}`);
      return { results: [], hasMore: false };
    }
  }

  /**
   * 从 alicesw 搜索页 HTML 解析书籍结果
   * @param {import('cheerio').CheerioAPI} $
   * @returns {Array<{title: string, url: string, snippet: string}>}
   */
  #parseSearchResults($) {
    const results = [];
    const seen = new Set();

    $('a[href^="/novel/"]').each((_i, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const title = $el.text().trim();

      if (!title || title.length < 2) return;

      let bookUrl = this.normalizeBookUrl(href.startsWith('http') ? href : BASE_URL + href);
      if (seen.has(bookUrl)) return;
      seen.add(bookUrl);

      let snippet = '';
      const $parent = $el.parent();
      if ($parent.length) {
        snippet = $parent.text().replace(title, '').trim().substring(0, 200);
      }

      results.push({
        title: title.replace(/\s+/g, ' ').trim(),
        url: bookUrl,
        snippet,
      });
    });

    return results;
  }

  /**
   * 从 alicesw 搜索页 HTML 检测是否有更多分页结果
   * @param {import('cheerio').CheerioAPI} $ - cheerio 实例
   * @param {number} currentPage - 当前页码（从 1 开始）
   * @param {number} resultCount - 当前页结果数
   * @returns {boolean}
   */
  #extractAliceswHasMore($, currentPage, resultCount) {
    // Signal 1: "下一页" 链接 — 最直接的信号
    const nextLinks = $('a:contains("下一页"), a:contains(">"), a:contains("»")');
    for (const el of nextLinks) {
      const href = $(el).attr('href') || '';
      const pageMatch = href.match(/[?&]p=(\d+)/);
      if (pageMatch && parseInt(pageMatch[1], 10) > currentPage) return true;
      // 没有页码参数但有"下一页"文本，假设有效
      if (!pageMatch) return true;
    }

    // Signal 2: rel="next" 语义化链接
    const relNext = $('a[rel="next"]');
    if (relNext.length > 0) {
      const href = relNext.attr('href') || '';
      const pageMatch = href.match(/[?&]p=(\d+)/);
      if (!pageMatch || parseInt(pageMatch[1], 10) > currentPage) return true;
    }

    // Signal 3: 分页容器中的页码链接
    const pageSelectors = [
      '.pagination, .pagelist, .page-nav, .pager, .pages',
      'div.page, ul.page, nav.pagination',
      'nav[aria-label="pagination"]',
    ];
    for (const sel of pageSelectors) {
      const $container = $(sel);
      if ($container.length > 0) {
        const pageLinks = $container.find('a[href*="p="]');
        const pageNumbers = [];
        pageLinks.each((_i, el) => {
          const href = $(el).attr('href') || '';
          const m = href.match(/[?&]p=(\d+)/);
          if (m) pageNumbers.push(parseInt(m[1], 10));
        });
        if (pageNumbers.length > 0) {
          const maxPage = Math.max(...pageNumbers);
          if (maxPage > currentPage) return true;
        }
        // 有多个分页链接，即使没有数字也假设有更多
        if (pageLinks.length > 1) return true;
      }
    }

    // Signal 4: "末页"/"尾页" 链接 — 暗示分页存在
    if ($('a:contains("末页"), a:contains("尾页"), a:contains("last")').length > 0) return true;

    // Fallback: 结果数不足典型页容量 → 最后一页
    if (resultCount < 20) return false;

    // 保守回退：满页无明确信号，假设可能还有
    return true;
  }
}
