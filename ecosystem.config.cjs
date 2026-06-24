// PM2 进程管理配置
module.exports = {
  apps: [
    {
      name: 'book-crawler',
      script: './src/server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 8001,
        API_BASE_URL: 'http://localhost:9000',
        CRAWLER_API_BASE_URL: 'http://localhost:9006',
        API_TIMEOUT: '30000',
        CRAWLER_USERNAME: 'crawler',
        CRAWLER_PASSWORD: '123456',
        WS_URL: 'ws://localhost:9005',
        GOOGLE_SEARCH_URL: 'https://www.google.com/search',
        BASE_URL: 'https://www.69shuba.com',
      },
      // 自动重启配置
      max_memory_restart: '512M',
      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
    },
  ],
};
