/**
 * 应用配置 - 从环境变量读取，提供默认值
 */
export default {
  server: {
    port: parseInt(process.env.PORT, 10) || 8001,
  },

  mysql: {
    host: process.env.MYSQL_HOST || '192.168.250.50',
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    user: process.env.MYSQL_USER || 'acat_remote',
    password: process.env.MYSQL_PASSWORD || 'mysql@acat.fun',
    database: process.env.MYSQL_DATABASE || 'acat_dev',
    charset: 'utf8mb4',
  },

  mongodb: {
    host: process.env.MONGODB_HOST || '192.168.250.51',
    port: parseInt(process.env.MONGODB_PORT, 10) || 27017,
    database: process.env.MONGODB_DATABASE || 'acat_dev',
  },

  crawler: {
    googleSearchUrl: process.env.GOOGLE_SEARCH_URL || 'https://www.google.com/search',
    baseUrl: process.env.BASE_URL || 'https://www.69shuba.com',
    defaultCover: 'https://static.69shuba.com/images/nocover.jpg',

    // XPath / CSS selectors for scraping
    selectors: {
      book: {
        title: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(1) > div > div:nth-child(2) > h1 > a',
        author: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(1) > div > div:nth-child(2) > p:nth-child(1) > a',
        cover: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(1) > div > div:nth-child(1) > img',
        category: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(1) > div > div:nth-child(2) > p:nth-child(2) > a',
        status: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(1) > div > div:nth-child(2) > p:nth-child(3)',
        introduction: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(2) > div > div:nth-child(2) > div > p:nth-child(1)',
        tags: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(2) > div:nth-child(1) > ul > li',
        introExpandLink: 'body > div:nth-child(2) > ul > li:nth-child(1) > div:nth-child(2) > ul > li:nth-child(2) > a',
      },
      chapter: {
        catalog: '#catalog',
        catalogItems: '#catalog li',
        content: 'body > div:nth-child(2) > div:nth-child(1) > div:nth-child(3)',
      },
    },
  },
};
