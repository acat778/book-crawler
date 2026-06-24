/**
 * 应用配置 - 从环境变量读取，提供默认值
 */
export default {
  server: {
    port: parseInt(process.env.PORT, 10) || 8001,
  },

  /** acat-book-book 后端 API 配置 */
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:9000',
    /** crawler API base URL — 默认与 baseUrl 相同（通过 Gateway），可单独配置直连 crawler 服务 */
    crawlerBaseUrl: process.env.CRAWLER_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:9000',
    timeout: parseInt(process.env.API_TIMEOUT, 10) || 30000,
  },

  crawler: {
    /** 爬虫 worker 用户 ID（create_by / update_by） */
    userId: parseInt(process.env.CRAWLER_USER_ID, 10) || 4,

    /** acat-book-book 登录凭据 */
    username: process.env.CRAWLER_USERNAME || 'crawler',
    password: process.env.CRAWLER_PASSWORD || '123456',

    /** Google 搜索 URL（69shuba 适配器 DuckDuckGo 搜索时用于识别重定向） */
    googleSearchUrl: process.env.GOOGLE_SEARCH_URL || 'https://www.google.com/search',
  },

  /** WebSocket 直连 acat-book-websocket 爬虫端点（不走网关） */
  ws: {
    /** WebSocket 服务地址（直连，非网关） */
    url: process.env.WS_URL || 'ws://localhost:9005',
    /** 爬虫认证 token（与用户 Sa-Token 独立） */
    token: process.env.CRAWLER_WS_TOKEN || '',
    /** 重连间隔 ms（指数退避基准值） */
    reconnectIntervalMs: parseInt(process.env.WS_RECONNECT_MS, 10) || 5000,
  },
};
