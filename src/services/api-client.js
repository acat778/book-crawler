import axios from 'axios';
import { parse, LosslessNumber, isInteger } from 'lossless-json';
import config from '../config.js';

/**
 * 递归将 LosslessNumber 转为安全类型：
 * - 在 Number.MAX_SAFE_INTEGER 范围内的整数 → number
 * - 超出范围的 → string（保留完整精度）
 */
function reviveNumbers(obj) {
  if (obj instanceof LosslessNumber) {
    const n = Number(obj.value);
    if (Number.isSafeInteger(n) && isInteger(obj.value)) {
      return n;
    }
    return obj.value; // 超出安全范围，保持字符串
  }
  if (Array.isArray(obj)) {
    return obj.map(reviveNumbers);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = reviveNumbers(v);
    }
    return result;
  }
  return obj;
}

/**
 * HTTP 客户端 — 封装对 acat-book-book 后端 REST API 的调用
 *
 * 特性：
 * - 单例模式，全进程共享同一 token
 * - Lazy login：首次调用时自动登录
 * - 401 自动重试：检测到 token 过期后重新登录并重放请求（仅重试一次）
 *
 * 使用示例：
 *   const api = ApiClient.getInstance();
 *   const author = await api.matchAuthor('作者名');
 *   const book = await api.createBook({ ... });
 */
export class ApiClient {

  /** @type {ApiClient|null} */
  static #instance = null;

  /**
   * 获取单例实例
   * @returns {ApiClient}
   */
  static getInstance() {
    if (!ApiClient.#instance) {
      ApiClient.#instance = new ApiClient();
    }
    return ApiClient.#instance;
  }

  /**
   * 重置单例（仅用于测试）
   */
  static resetInstance() {
    ApiClient.#instance = null;
  }

  constructor() {
    this.baseUrl = config.api.baseUrl;
    this.crawlerBaseUrl = config.api.crawlerBaseUrl;
    this.timeout = config.api.timeout;
    this.username = config.crawler.username;
    this.password = config.crawler.password;

    /** @type {string|null} 缓存的 Bearer token */
    this.token = null;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json' },
      // 使用 lossless-json 解析，保留超出 JS 安全整数范围的大整数
      transformResponse: [(data) => {
        if (typeof data === 'string') {
          try {
            return reviveNumbers(parse(data));
          } catch {
            return data;
          }
        }
        return data;
      }],
      // 将超出安全整数范围的字符串 ID 还原为 JSON 数字（字符串替换，不丢失精度）
      transformRequest: [(data) => {
        if (data && typeof data === 'object' && !(data instanceof FormData)) {
          const json = JSON.stringify(data);
          // 匹配 "key":"digits" 中将 16+ 位纯数字字符串转为原生数字
          return json.replace(/": *"(\d{16,})"/g, '": $1');
        }
        return data;
      }],
    });
  }

  // ==================== Token 管理 ====================

  /**
   * 确保已获取 token（懒加载）
   */
  async ensureToken() {
    if (this.token) return this.token;
    return this.login();
  }

  /**
   * 登录获取 token
   * POST /api/book/user/auth/login
   */
  async login() {
    try {
      const resp = await axios.post(
        `${this.baseUrl}/api/book/user/auth/login`,
        { username: this.username, password: this.password },
        { timeout: this.timeout, headers: { 'Content-Type': 'application/json' } },
      );

      if (resp.data?.code !== 0) {
        throw new Error(`登录失败: ${resp.data?.message || 'unknown error'}`);
      }

      this.token = resp.data.data.token;
      console.log(`[ApiClient] 登录成功 (userId=${resp.data.data.userId}, username=${resp.data.data.username})`);
      return this.token;
    } catch (err) {
      if (err.response) {
        throw new Error(`登录失败 (HTTP ${err.response.status}): ${err.response.data?.message || err.message}`);
      }
      throw new Error(`登录失败: ${err.message}`);
    }
  }

  // ==================== 底层请求 ====================

  /**
   * GET 请求（带 token 和 401 重试）
   */
  async get(path, params = {}) {
    await this.ensureToken();

    try {
      const resp = await this.http.get(path, {
        params,
        headers: { satoken: this.token },
      });
      // Sa-Token: 业务级 401 也触发重新登录
      if (resp.data?.code === 401) {
        console.warn('[ApiClient] Token 过期（业务 401），重新登录并重试');
        this.token = null;
        await this.login();
        const retryResp = await this.http.get(path, {
          params,
          headers: { satoken: this.token },
        });
        return retryResp.data;
      }
      return resp.data;
    } catch (err) {
      if (err.response?.status === 401) {
        console.warn('[ApiClient] Token 过期（HTTP 401），重新登录并重试');
        this.token = null;
        await this.login();
        const resp = await this.http.get(path, {
          params,
          headers: { satoken: this.token },
        });
        return resp.data;
      }
      throw err;
    }
  }

  /**
   * POST 请求（带 token 和 401 重试）
   * @param {boolean} [isFormData=false] - 是否为 multipart/form-data
   */
  async post(path, body = {}, isFormData = false) {
    await this.ensureToken();

    const headers = { satoken: this.token };
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    // axios 在 body 为 FormData 时自动设置 Content-Type 和 boundary

    try {
      const resp = await this.http.post(path, body, { headers });
      // Sa-Token: 业务级 401 也触发重新登录
      if (resp.data?.code === 401) {
        console.warn('[ApiClient] Token 过期（业务 401），重新登录并重试');
        this.token = null;
        await this.login();
        const headers2 = { satoken: this.token };
        if (!isFormData) {
          headers2['Content-Type'] = 'application/json';
        }
        const retryResp = await this.http.post(path, body, { headers: headers2 });
        return retryResp.data;
      }
      return resp.data;
    } catch (err) {
      if (err.response?.status === 401) {
        console.warn('[ApiClient] Token 过期（HTTP 401），重新登录并重试');
        this.token = null;
        await this.login();
        const headers2 = { satoken: this.token };
        if (!isFormData) {
          headers2['Content-Type'] = 'application/json';
        }
        const resp = await this.http.post(path, body, { headers: headers2 });
        return resp.data;
      }
      throw err;
    }
  }

  /**
   * PUT 请求（带 token 和 401 重试）
   */
  async put(path, body = {}) {
    await this.ensureToken();

    try {
      const resp = await this.http.put(path, body, {
        headers: { satoken: this.token },
      });
      // Sa-Token: 业务级 401 也触发重新登录
      if (resp.data?.code === 401) {
        console.warn('[ApiClient] Token 过期（业务 401），重新登录并重试');
        this.token = null;
        await this.login();
        const retryResp = await this.http.put(path, body, {
          headers: { satoken: this.token },
        });
        return retryResp.data;
      }
      return resp.data;
    } catch (err) {
      if (err.response?.status === 401) {
        console.warn('[ApiClient] Token 过期（HTTP 401），重新登录并重试');
        this.token = null;
        await this.login();
        const resp = await this.http.put(path, body, {
          headers: { satoken: this.token },
        });
        return resp.data;
      }
      throw err;
    }
  }

  // ==================== Crawler API — 查询/匹配 ====================

  /**
   * 按全名精确匹配作者
   * GET /api/book/crawler/authors?match=X
   * @param {string} name - 作者名
   * @returns {Promise<{id: string, name: string}|null>}
   */
  async matchAuthor(name) {
    try {
      const resp = await this.get(`${this.crawlerBaseUrl}/api/book/crawler/authors`, { match: name });
      if (resp?.code !== 0) return null;
      return resp.data || null; // data 为 null 或 {id, name}
    } catch (err) {
      console.warn('[ApiClient] matchAuthor 失败:', err.message);
      return null;
    }
  }

  /**
   * 按全名精确匹配分类
   * GET /api/book/crawler/categories?match=X
   * @param {string} name - 分类名称
   * @returns {Promise<{id: string, name: string}|null>}
   */
  async matchCategory(name) {
    try {
      const resp = await this.get(`${this.crawlerBaseUrl}/api/book/crawler/categories`, { match: name });
      if (resp?.code !== 0) return null;
      return resp.data || null;
    } catch (err) {
      console.warn('[ApiClient] matchCategory 失败:', err.message);
      return null;
    }
  }

  /**
   * 按全名列表批量匹配标签
   * GET /api/book/crawler/tags?match=tag1&match=tag2
   * @param {string[]} names - 标签名称列表
   * @returns {Promise<Array<{tag: string, id: string}>>}
   */
  async matchTags(names) {
    if (!names || names.length === 0) return [];
    try {
      // Spring @RequestParam List<String> → match=val1&match=val2
      const params = new URLSearchParams();
      for (const n of names) {
        params.append('match', n);
      }
      const resp = await this.get(`${this.crawlerBaseUrl}/api/book/crawler/tags?${params.toString()}`);
      if (resp?.code !== 0) return [];
      return resp.data || [];
    } catch (err) {
      console.warn('[ApiClient] matchTags 失败:', err.message);
      return [];
    }
  }

  /**
   * 按书名 + 作者名精确匹配书籍
   * GET /api/book/crawler/books?title=X&authorName=Y
   * @param {string} title - 书名
   * @param {string} authorName - 作者名
   * @returns {Promise<{id: string, title: string}|null>}
   */
  async matchBook(title, authorName) {
    try {
      const resp = await this.get(`${this.crawlerBaseUrl}/api/book/crawler/books`, { title, authorName });
      if (resp?.code !== 0) return null;
      return resp.data || null;
    } catch (err) {
      console.warn('[ApiClient] matchBook 失败:', err.message);
      return null;
    }
  }

  // ==================== Crawler API — 创建 ====================

  /**
   * 通过 crawler API 创建作者
   * POST /api/book/crawler/authors
   * @param {string} name - 作者名
   * @param {string} [description=''] - 作者简介
   * @returns {Promise<{id: number, name: string}|null>}
   */
  async createCrawlerAuthor(name, description = '') {
    try {
      const resp = await this.post(`${this.crawlerBaseUrl}/api/book/crawler/authors`, { name, description });
      if (resp?.code !== 0) {
        console.warn(`[ApiClient] 创建作者失败: ${resp?.message || 'unknown'}`);
        return null;
      }
      console.log(`[ApiClient] 创建作者成功: id=${resp.data.id}, name=${resp.data.name}`);
      return resp.data;
    } catch (err) {
      console.warn(`[ApiClient] 创建作者异常: ${name}`, err.message);
      return null;
    }
  }

  /**
   * 通过 crawler API 创建分类
   * POST /api/book/crawler/categories
   * @param {string} name - 分类名称（显示名）
   * @param {string} code - 分类编码（唯一标识）
   * @returns {Promise<{id: number, name: string}|null>}
   */
  async createCrawlerCategory(name, code) {
    try {
      const resp = await this.post(`${this.crawlerBaseUrl}/api/book/crawler/categories`, { name, code });
      if (resp?.code !== 0) {
        console.warn(`[ApiClient] 创建分类失败: ${resp?.message || 'unknown'}`);
        return null;
      }
      console.log(`[ApiClient] 创建分类成功: id=${resp.data.id}, name=${resp.data.name}`);
      return resp.data;
    } catch (err) {
      console.warn(`[ApiClient] 创建分类异常: ${name}`, err.message);
      return null;
    }
  }

  /**
   * 通过 crawler API 创建标签
   * POST /api/book/crawler/tags
   * @param {string} name - 标签名称（显示名）
   * @param {string} code - 标签编码（唯一标识）
   * @returns {Promise<{id: number, name: string}|null>}
   */
  async createCrawlerTag(name, code) {
    try {
      const resp = await this.post(`${this.crawlerBaseUrl}/api/book/crawler/tags`, { name, code });
      if (resp?.code !== 0) {
        console.warn(`[ApiClient] 创建标签失败: ${resp?.message || 'unknown'}`);
        return null;
      }
      console.log(`[ApiClient] 创建标签成功: id=${resp.data.id}, name=${resp.data.name}`);
      return resp.data;
    } catch (err) {
      console.warn(`[ApiClient] 创建标签异常: ${name}`, err.message);
      return null;
    }
  }

  /**
   * 通过 crawler API 创建章节（含内容，自动按 \\n\\n 分段）
   * POST /api/book/crawler/chapters
   * @param {number} bookId - 书籍 ID
   * @param {string} title - 章节标题
   * @param {string} [content=''] - 章节内容（段落以 \\n\\n 分隔）
   * @returns {Promise<{id: number, title: string, sortOrder: number}|null>}
   */
  async createChapter(bookId, title, content = '') {
    try {
      const resp = await this.post(`${this.crawlerBaseUrl}/api/book/crawler/chapters`, { bookId, title, content });
      if (resp?.code !== 0) {
        console.warn(`[ApiClient] 创建章节失败: ${resp?.message || 'unknown'}`);
        return null;
      }
      return resp.data;
    } catch (err) {
      console.warn(`[ApiClient] 创建章节异常: ${title}`, err.message);
      return null;
    }
  }

  /**
   * 追加段落到已有章节（按 \\n\\n 分段）
   * POST /api/book/crawler/chapters/{chapterId}/paragraphs
   * @param {number} chapterId - 章节 ID
   * @param {string} content - 段落内容（以 \\n\\n 分隔多个段落）
   * @returns {Promise<number>} 追加的段落数
   */
  async appendParagraphs(chapterId, content) {
    try {
      const resp = await this.post(`${this.crawlerBaseUrl}/api/book/crawler/chapters/${chapterId}/paragraphs`, { content });
      if (resp?.code !== 0) {
        console.warn(`[ApiClient] 追加段落失败: ${resp?.message || 'unknown'}`);
        return 0;
      }
      console.log(`[ApiClient] 追加段落成功: chapterId=${chapterId}, count=${resp.data}`);
      return resp.data || 0;
    } catch (err) {
      console.warn(`[ApiClient] 追加段落异常: chapterId=${chapterId}`, err.message);
      return 0;
    }
  }

  // ==================== Crawler API — 书籍 ====================

  /**
   * 通过 crawler API 创建书籍（含标签关联）
   * POST /api/book/crawler/books
   * @param {object} param - CreateBookParam { title, authorId, description?, category?, status?, isAdult?, tagIds?, coverId? }
   * @returns {Promise<{id: string, title: string}|null>}
   */
  async createCrawlerBook(param) {
    try {
      const resp = await this.post(`${this.crawlerBaseUrl}/api/book/crawler/books`, param);
      if (resp?.code !== 0) {
        console.warn(`[ApiClient] 创建书籍失败: ${resp?.message || 'unknown'}`);
        return null;
      }
      console.log(`[ApiClient] 创建书籍成功: id=${resp.data.id}, title=${resp.data.title}`);
      return resp.data;
    } catch (err) {
      console.warn(`[ApiClient] 创建书籍异常: ${param.title}`, err.message);
      return null;
    }
  }

  // ==================== 文件上传 ====================

  /**
   * 下载远程图片并上传到文件服务
   * @param {string} imageUrl - 远程图片 URL
   * @returns {Promise<object|null>} 文件信息 { id, name, path, ... }，失败返回 null
   */
  async uploadCover(imageUrl) {
    // 1. 下载图片
    /** @type {ArrayBuffer} */
    let imageBuffer;
    let contentType = 'image/jpeg';
    try {
      const resp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      imageBuffer = Buffer.from(resp.data);
      if (resp.headers['content-type']) {
        contentType = resp.headers['content-type'];
      }
    } catch (err) {
      console.warn(`[ApiClient] 封面下载失败: ${imageUrl}`, err.message);
      return null;
    }

    // 2. 构建 multipart/form-data
    // Node 18+ 原生 FormData + Blob
    const blob = new Blob([imageBuffer], { type: contentType });
    const formData = new FormData();
    formData.set('file', blob, 'cover.jpg');

    // 3. 上传
    try {
      await this.ensureToken();
      const resp = await this.http.post(
        '/api/book/file/upload',
        formData,
        {
          headers: {
            satoken: this.token,
            // axios 自动设置 Content-Type 为 multipart/form-data + boundary
          },
          timeout: 30000,
        },
      );

      if (resp.data?.code !== 0) {
        console.warn(`[ApiClient] 封面上传失败: ${resp.data?.message || 'unknown'}`);
        return null;
      }
      console.log(`[ApiClient] 封面上传成功: fileId=${resp.data.data.id}, name=${resp.data.data.name}`);
      return resp.data.data;
    } catch (err) {
      if (err.response?.status === 401) {
        console.warn('[ApiClient] Token 过期（上传），重新登录后不重试上传');
      }
      console.warn(`[ApiClient] 封面上传异常: ${imageUrl}`, err.message);
      return null;
    }
  }

}
