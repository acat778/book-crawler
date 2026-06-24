/**
 * SiteAdapter 基类 — 定义站点适配器接口
 *
 * 每个目标站点（69shuba、alicesw 等）继承此类，实现站点特定的：
 * - URL 模式（书籍、章节、目录）
 * - HTML 解析规则（书籍元数据、章节目录、章节正文）
 * - 搜索策略（站内搜索或外部搜索引擎）
 * - Puppeteer 交互（如点击"展开"链接）
 *
 * 使用方式：
 *   class Site69shuba extends SiteAdapter { ... }
 *   const adapter = new Site69shuba();
 *   const meta = adapter.parseBookMeta($, html, url);
 */

export class SiteAdapter {

  // ==================== 站点标识（必须覆盖） ====================

  /** @returns {string} 站点唯一标识，如 '69shuba' */
  get id() { throw new Error('Not implemented: id'); }

  /** @returns {string} 站点显示名称，如 '69书吧' */
  get displayName() { throw new Error('Not implemented: displayName'); }

  /** @returns {string} 站点基础 URL，如 'https://www.69shuba.com' */
  get baseUrl() { throw new Error('Not implemented: baseUrl'); }

  // ==================== URL 模式（必须覆盖） ====================

  /**
   * 从书籍 URL 提取站点内部书籍 ID
   * @param {string} url - 书籍页面完整 URL
   * @returns {string|null}
   */
  extractBookId(url) { throw new Error('Not implemented: extractBookId'); }

  /**
   * 构建目录页 URL
   * @param {string} bookId - 站点内部书籍 ID
   * @returns {string}
   */
  buildCatalogUrl(bookId) { throw new Error('Not implemented: buildCatalogUrl'); }

  /**
   * 标准化书籍 URL（清理搜索结果的 URL 变体）
   * @param {string} url
   * @returns {string}
   */
  normalizeBookUrl(url) { throw new Error('Not implemented: normalizeBookUrl'); }

  /**
   * 判断 URL 是否为该站点的书籍详情页
   * @param {string} url
   * @returns {boolean}
   */
  isBookUrl(url) { throw new Error('Not implemented: isBookUrl'); }

  /**
   * 目录页加载等待选择器（Puppeteer waitForSelector 用）
   * @returns {string}
   */
  getCatalogWaitSelector() { throw new Error('Not implemented: getCatalogWaitSelector'); }

  /**
   * 默认封面图片 URL
   * @returns {string}
   */
  getDefaultCover() { throw new Error('Not implemented: getDefaultCover'); }

  /**
   * 站点默认 18 禁标志：0=全年龄, 1=18禁
   * 子类按需覆盖（如爱丽丝书屋覆盖为 1）
   * @returns {number}
   */
  get isAdult() { return 0; }

  // ==================== 解析方法（必须覆盖） ====================

  /**
   * 从书籍页面 HTML 解析所有元数据
   * @param {import('cheerio').CheerioAPI} $ - cheerio 实例
   * @param {string} html - 原始 HTML
   * @param {string} bookUrl - 书籍页面 URL
   * @returns {{success: boolean, message?: string, title?: string, authorName?: string,
   *            categoryName?: string, statusText?: string, introduction?: string,
   *            coverUrl?: string, tags?: string[]}}
   */
  parseBookMeta($, html, bookUrl) { throw new Error('Not implemented: parseBookMeta'); }

  /**
   * 从目录页 HTML 提取章节链接列表
   * @param {import('cheerio').CheerioAPI} $ - cheerio 实例
   * @returns {Array<{title: string, url: string, sortOrder: number}>}
   */
  parseChapterLinks($) { throw new Error('Not implemented: parseChapterLinks'); }

  /**
   * 从章节页面 HTML 提取段落文本数组
   * @param {import('cheerio').CheerioAPI} $ - cheerio 实例
   * @returns {string[]}
   */
  extractChapterParagraphs($) { throw new Error('Not implemented: extractChapterParagraphs'); }

  // ==================== Puppeteer 交互钩子（可选覆盖） ====================

  /**
   * 在解析书籍详情页之前执行页面交互
   * 用于点击"展开"链接、等待懒加载内容等
   * @param {import('puppeteer').Page} page
   * @returns {Promise<void>}
   */
  async beforeParseBookDetail(page) {
    // 默认无操作
  }

  /**
   * 获取书籍详情页加载等待选择器
   * @returns {string}
   */
  getBookDetailWaitSelector() {
    return 'h1, meta[property="og:title"]';
  }

  // ==================== 搜索方法（必须覆盖） ====================

  /**
   * 搜索书籍
   * @param {string} keyword - 搜索关键词
   * @param {number} pageNum - 页码（从 0 开始）
   * @returns {Promise<{results: Array<{title:string, url:string, snippet:string}>, hasMore: boolean}>}
   */
  async search(keyword, pageNum = 0) {
    throw new Error('Not implemented: search');
  }

  // ==================== 共享工具方法 ====================

  /**
   * 从 meta 标签提取内容（OG 标签通用）
   * @param {import('cheerio').CheerioAPI} $
   * @param {string} property - meta property 值
   * @returns {string}
   */
  _metaTag($, property) {
    return $(`meta[property="${property}"]`).attr('content') || '';
  }
}
