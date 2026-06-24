import { WsClient } from './ws-client.js';

/**
 * 爬虫数据发送器 — 通过 WebSocket 推送爬取数据到 acat-book-websocket，
 * 由 book-service 监听 Redis 频道消费并持久化。
 *
 * 封面图片仍然通过 HTTP REST 上传（multipart/form-data 不适合 WS）。
 */
export class CrawlerDataSender {

  constructor() {
    this.ws = WsClient.getInstance();
  }

  /**
   * 确保 WS 已连接（阻塞直到连接成功，无限重试）
   */
  async ensureConnected() {
    if (this.ws.connected) return;

    // 触发连接（后台自动重连）
    try {
      await this.ws.connect();
    } catch {
      // connect 失败时已在后台调度重连，等待连接成功
    }

    // 轮询等待连接成功（每 500ms 检查一次）
    while (!this.ws.connected) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // ==================== 数据推送 ====================

  /**
   * 推送爬取的完整书籍数据（含作者/分类/标签/封面URL）
   * book-service 收到后负责：查找或创建作者/分类/标签、通过 file API 上传封面、创建书籍记录
   *
   * @param {object} params
   * @param {string} params.title - 书名
   * @param {string} params.authorName - 作者名
   * @param {string} [params.authorDescription] - 作者简介
   * @param {string} [params.categoryName] - 分类名
   * @param {string[]} [params.tagNames] - 标签名列表
   * @param {string} [params.coverUrl] - 封面图片 URL（book-service 下载并通过 file API 上传）
   * @param {string} [params.description] - 书籍简介
   * @param {number} [params.status] - 书籍状态 0=连载 1=完结
   * @param {number} [params.isAdult] - 是否成人内容
   * @param {string} [params.catalogUrl] - 目录页 URL
   * @param {string} [params.thirdPartyBookId] - 第三方站点书籍 ID
   * @param {object[]} [params.chapterLinks] - 章节链接列表 [{title, url, sortOrder}]
   * @returns {Promise<object>} ACK 响应
   */
  async pushBook(params) {
    await this.ensureConnected();
    return this.ws.send('push_book', {
      title: params.title,
      authorName: params.authorName || '佚名',
      authorDescription: params.authorDescription || '',
      categoryName: params.categoryName || '',
      tagNames: params.tagNames || [],
      coverUrl: params.coverUrl || '',
      description: params.description || '',
      status: params.status ?? 0,
      isAdult: params.isAdult ?? 0,
      catalogUrl: params.catalogUrl || '',
      thirdPartyBookId: params.thirdPartyBookId || '',
      chapterLinks: params.chapterLinks || [],
    });
  }

  // WebSocket 消息最大约 400KB（服务器缓冲区 512KB，留安全余量）
  static MAX_WS_PAYLOAD = 400 * 1024;

  /**
   * 推送章节内容
   * 若内容过大（>400KB）会抛出异常，调用方应回退 REST
   * @param {string} bookId - 书籍 ID（book-service 返回的内部 ID）
   * @param {string} title - 章节标题
   * @param {string} content - 章节内容（段落以 \n\n 分隔）
   * @param {number} [sortOrder] - 排序号
   * @returns {Promise<object>} ACK 响应
   */
  async pushChapter(bookId, title, content, sortOrder) {
    await this.ensureConnected();
    const payload = JSON.stringify({ bookId, title, content, sortOrder });
    if (Buffer.byteLength(payload, 'utf8') > CrawlerDataSender.MAX_WS_PAYLOAD) {
      throw new Error(`[CrawlerDataSender] 章节内容过大 (${Buffer.byteLength(payload, 'utf8')} bytes)，应使用 REST`);
    }
    return this.ws.send('push_chapter', { bookId, title, content, sortOrder });
  }

  /**
   * 追加段落到已有章节
   * @param {number} chapterId
   * @param {string} content - 段落内容（以 \n\n 分隔）
   * @returns {Promise<object>} ACK 响应
   */
  async pushParagraphs(chapterId, content) {
    await this.ensureConnected();
    const payload = JSON.stringify({ chapterId, content });
    if (Buffer.byteLength(payload, 'utf8') > CrawlerDataSender.MAX_WS_PAYLOAD) {
      throw new Error(`[CrawlerDataSender] 段落内容过大 (${Buffer.byteLength(payload, 'utf8')} bytes)，应使用 REST`);
    }
    return this.ws.send('push_paragraphs', { chapterId, content });
  }

  /**
   * 上报任务状态
   * @param {string} bookId
   * @param {'crawling'|'completed'|'failed'} status
   * @param {object} [extra] - 额外信息
   */
  async sendTaskStatus(bookId, status, extra = {}) {
    await this.ensureConnected();
    return this.ws.send('task_status', { bookId, status, ...extra });
  }

  // ==================== 频道订阅 ====================

  /**
   * 订阅书籍处理结果推送
   * book-service 处理完 push_book 后会发布结果到 ws:crawler:book:result
   * @param {Function} callback - 收到结果时的回调 ({ bookId, internalBookId, success, error? })
   */
  onBookResult(callback) {
    this.ws.subscribe('ws:crawler:book:result', (msg) => {
      callback(msg.data || msg);
    });
  }

  /**
   * 订阅章节处理结果
   * @param {Function} callback
   */
  onChapterResult(callback) {
    this.ws.subscribe('ws:crawler:chapter:result', (msg) => {
      callback(msg.data || msg);
    });
  }

  /**
   * 订阅任务通知（如停止爬取指令）
   * @param {Function} callback
   */
  onTaskNotification(callback) {
    this.ws.subscribe('ws:crawler:task:notification', (msg) => {
      callback(msg.data || msg);
    });
  }
}

/** @type {CrawlerDataSender|null} */
let defaultSender = null;

export function getCrawlerDataSender() {
  if (!defaultSender) {
    defaultSender = new CrawlerDataSender();
  }
  return defaultSender;
}
