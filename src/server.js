import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import crawlerRoutes from './routes/crawler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ==================== 中间件 ====================

app.use(cors({ origin: '*' }));
app.use(express.json());

// ==================== API 路由 ====================

app.use('/api/crawler', crawlerRoutes);
app.use('/api/read/admin/crawler/book', crawlerRoutes);

// ==================== 静态文件服务（生产环境） ====================

const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback: 非 API 请求返回 index.html
app.get('*', (req, res, next) => {
  // 跳过 API 路由
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
      // 如果前端还没构建，返回提示
      res.status(404).json({
        error: '前端静态文件未找到，请先运行: cd frontend && npm run build',
      });
    }
  });
});

// ==================== 启动服务器 ====================

async function main() {
  const port = config.server.port;

  app.listen(port, () => {
    console.log(`\n========================================`);
    console.log(`  Book Crawler Server v2.0.0`);
    console.log(`  http://localhost:${port}`);
    console.log(`  API: http://localhost:${port}/api/crawler`);
    console.log(`  Persistence: Prisma + MongoDB + RustFS`);
    console.log(`========================================\n`);
  });
}

main();
