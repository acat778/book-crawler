/**
 * WebSocket 客户端 — 直连 acat-book-websocket 爬虫端点，不经过网关。
 *
 * 特性：
 * - 单例模式，全进程共享一个 WS 连接
 * - 自动重连（指数退避，最大 30s）
 * - 请求-响应模式：每个消息携带 seq，通过 Promise 等待对应 ACK
 * - 支持服务器主动推送（通过 subscribe 订阅频道）
 *
 * 使用示例：
 *   const ws = WsClient.getInstance();
 *   await ws.connect();
 *   const result = await ws.send('push_book', { title: '...', authorId: 1 });
 */
import config from '../config.js';

export class WsClient {

  /** @type {WsClient|null} */
  static #instance = null;

  // ---- private instance fields ----
  /** @type {number} 消息序列号 */
  #seq = 0;
  /** @type {Map<number, {resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout>}>} */
  #pending = new Map();
  /** @type {Map<string, Set<Function>>} 频道 → 回调集合 */
  #subscribers = new Map();
  /** @type {boolean} */
  #connected = false;
  /** @type {number} 当前重试次数 */
  #retryCount = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  #reconnectTimer = null;

  static getInstance() {
    if (!WsClient.#instance) {
      WsClient.#instance = new WsClient();
    }
    return WsClient.#instance;
  }

  constructor() {
    this.url = config.ws.url;
    this.token = config.ws.token;
    this.reconnectMs = config.ws.reconnectIntervalMs;
    /** @type {import('ws').WebSocket|null} */
    this.ws = null;
  }

  // ==================== 连接管理 ====================

  /**
   * 建立 WebSocket 连接
   * 连接失败时自动调度重连，无限重试
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.#connected) return;

    const url = `${this.url}/ws/crawler?token=${encodeURIComponent(this.token)}`;
    console.log(`[WsClient] 连接爬虫 WS: ${this.url}/ws/crawler`);

    return new Promise((resolve, reject) => {
      try {
        const WS = globalThis.WebSocket;
        const ws = new WS(url);
        this.ws = ws;

        const timeout = setTimeout(() => {
          console.warn('[WsClient] WebSocket 连接超时，将自动重连');
          this.#scheduleReconnect();
          reject(new Error('WebSocket 连接超时'));
        }, 10000);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.#connected = true;
          this.#retryCount = 0;
          console.log('[WsClient] 爬虫 WS 已连接');
          resolve();
        };

        ws.onmessage = (event) => {
          this.#onMessage(event.data);
        };

        ws.onclose = (event) => {
          this.#connected = false;
          console.warn(`[WsClient] WS 断开: code=${event.code}, reason=${event.reason}`);
          this.#rejectAllPending(new Error('WebSocket 连接已断开'));
          this.#scheduleReconnect();
        };

        ws.onerror = (err) => {
          clearTimeout(timeout);
          console.warn('[WsClient] WS 错误:', err.message || err);
          // onclose 会紧接着触发，由 onclose 处理重连
        };
      } catch (err) {
        // 连接创建失败（如 URL 无效、网络不可达），调度重连
        console.warn('[WsClient] WS 创建失败，将自动重连:', err.message);
        this.#scheduleReconnect();
        reject(err);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // 阻止自动重连
      this.ws.close(1000, 'client disconnect');
      this.ws = null;
    }
    this.#connected = false;
    this.#rejectAllPending(new Error('客户端主动断开'));
  }

  /**
   * 是否已连接
   */
  get connected() {
    return this.#connected && this.ws?.readyState === WebSocket.OPEN;
  }

  // ==================== 发送消息 ====================

  /**
   * 发送消息并等待 ACK 响应
   * @param {string} action - 动作名
   * @param {object} [data={}] - 业务数据
   * @param {number} [timeoutMs=30000] - 超时时间
   * @returns {Promise<object>} 服务端 ACK 消息
   */
  send(action, data = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const seq = ++this.#seq;
      const msg = {
        module: 'crawler',
        action,
        seq,
        ts: Date.now(),
        data,
      };

      const timer = setTimeout(() => {
        this.#pending.delete(seq);
        reject(new Error(`请求超时: ${action} (seq=${seq})`));
      }, timeoutMs);

      this.#pending.set(seq, { resolve, reject, timer });

      try {
        this.ws.send(JSON.stringify(msg));
      } catch (err) {
        clearTimeout(timer);
        this.#pending.delete(seq);
        reject(err);
      }
    });
  }

  /**
   * 发送消息但不等待响应（fire-and-forget）
   * @param {string} action
   * @param {object} [data={}]
   */
  sendAsync(action, data = {}) {
    if (!this.connected) {
      console.warn(`[WsClient] 未连接，丢弃消息: ${action}`);
      return;
    }

    const seq = ++this.#seq;
    const msg = {
      module: 'crawler',
      action,
      seq,
      ts: Date.now(),
      data,
    };

    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn(`[WsClient] 发送失败: ${action}`, err.message);
    }
  }

  // ==================== 频道订阅 ====================

  /**
   * 订阅服务端推送频道
   * @param {string} channel - 频道名，如 ws:crawler:book:result
   * @param {Function} callback - 收到消息时的回调
   */
  subscribe(channel, callback) {
    if (!this.#subscribers.has(channel)) {
      this.#subscribers.set(channel, new Set());
      // 通知服务端订阅
      this.sendAsync('subscribe', { channels: [channel] });
    }
    this.#subscribers.get(channel).add(callback);
  }

  /**
   * 取消订阅
   * @param {string} channel
   * @param {Function} [callback] - 不传则移除该频道所有回调
   */
  unsubscribe(channel, callback) {
    if (!callback) {
      this.#subscribers.delete(channel);
      this.sendAsync('unsubscribe', { channels: [channel] });
      return;
    }
    const cbs = this.#subscribers.get(channel);
    if (cbs) {
      cbs.delete(callback);
      if (cbs.size === 0) {
        this.#subscribers.delete(channel);
        this.sendAsync('unsubscribe', { channels: [channel] });
      }
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 处理收到的消息
   */
  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn('[WsClient] 无法解析消息:', raw);
      return;
    }

    // 检查是否为待处理请求的 ACK
    const seq = msg.seq;
    if (seq != null && this.#pending.has(seq)) {
      const { resolve, timer } = this.#pending.get(seq);
      clearTimeout(timer);
      this.#pending.delete(seq);
      resolve(msg);
      return;
    }

    // 否则为服务器主动推送 — 分发给订阅者
    const channel = msg.module === 'crawler' && msg.action
      ? `ws:crawler:${msg.action}`
      : null;
    if (channel && this.#subscribers.has(channel)) {
      for (const cb of this.#subscribers.get(channel)) {
        try { cb(msg); } catch (err) { console.warn('[WsClient] 订阅回调错误:', err); }
      }
    }
  }

  /**
   * 拒绝所有待处理请求
   */
  #rejectAllPending(reason) {
    for (const [seq, { reject, timer }] of this.#pending) {
      clearTimeout(timer);
      reject(reason);
    }
    this.#pending.clear();
  }

  /**
   * 调度自动重连（指数退避，无限重试，永不放弃）
   */
  #scheduleReconnect() {
    if (this.#reconnectTimer) return;

    // 指数退避：5s → 7.5s → 11.2s → ... → 最大 30s
    const delay = Math.min(this.reconnectMs * Math.pow(1.5, this.#retryCount), 30000);
    this.#retryCount++;
    console.log(`[WsClient] ${(delay / 1000).toFixed(1)}s 后重连 (第 ${this.#retryCount} 次)`);

    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      try {
        await this.connect();
        // 连接成功后 #retryCount 会在 onopen 中重置为 0
      } catch {
        // connect() 内部已调用 #scheduleReconnect()，无需额外处理
      }
    }, delay);
  }
}
