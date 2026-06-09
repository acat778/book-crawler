// PM2 进程管理配置
module.exports = {
  apps: [
    {
      name: 'book-crawler',
      script: './server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 8001,
        MYSQL_HOST: '192.168.250.50',
        MYSQL_PORT: 3306,
        MYSQL_USER: 'acat_remote',
        MYSQL_PASSWORD: 'mysql@acat.fun',
        MYSQL_DATABASE: 'acat_dev',
        MONGODB_HOST: '192.168.250.51',
        MONGODB_PORT: 27017,
        MONGODB_DATABASE: 'acat_dev',
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
