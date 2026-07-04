/**
 * 应用配置 - 从环境变量读取，提供默认值
 */
export default {
  server: {
    port: parseInt(process.env.PORT, 10) || 8609,
  },

  /** acat-book-book 后端 API 配置 */
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:9000',
    /** crawler API base URL — 默认与 baseUrl 相同（通过 Gateway），可单独配置直连 crawler 服务 */
    crawlerBaseUrl: process.env.CRAWLER_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:9000',
    timeout: parseInt(process.env.API_TIMEOUT, 10) || 30000,
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/acat_dev?authSource=admin',
    dbName: process.env.MONGO_DB || 'acat_dev',
  },

  storage: {
    endpoint: process.env.RUSTFS_ENDPOINT || 'http://localhost:9002',
    accessKey: process.env.RUSTFS_ACCESS_KEY || 'rustfsadmin',
    secretKey: process.env.RUSTFS_SECRET_KEY || 'rustfsadmin',
    bucket: process.env.RUSTFS_BUCKET || 'acat-book',
    region: process.env.RUSTFS_REGION || 'us-east-1',
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

};
