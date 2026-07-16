/**
 * 应用配置 - 从环境变量读取，提供默认值
 */
export default {
  server: {
    port: parseInt(process.env.PORT, 10) || 8609,
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/acat_dev?authSource=admin',
    dbName: process.env.MONGO_DB || 'acat_dev',
  },

  storage: {
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9003',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'acat-book',
    region: process.env.MINIO_REGION || 'us-east-1',
  },

  crawler: {
    /** 爬虫 worker 用户 ID（create_by / update_by） */
    userId: parseInt(process.env.CRAWLER_USER_ID, 10) || 4,

    /** Google 搜索 URL（69shuba 适配器 DuckDuckGo 搜索时用于识别重定向） */
    googleSearchUrl: process.env.GOOGLE_SEARCH_URL || 'https://www.google.com/search',
  },

};
