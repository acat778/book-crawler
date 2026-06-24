# Book Crawler — 书籍爬虫工具

通过 Google 搜索 [69shuba.com](https://www.69shuba.com) 书籍，自动提取书名、作者、分类、目录，并将章节内容通过 WebSocket 推送到后端服务。

> v5.0: 章节内容通过 WebSocket 直连 `acat-book-websocket` 推送（不走网关），书籍元数据仍通过 REST API 操作。

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Node.js ≥ 18 |
| **后端框架** | Express 4.x |
| **前端框架** | React 19 + TypeScript |
| **构建工具** | Vite 8.x |
| **HTML 解析** | Cheerio（服务端 jQuery） |
| **HTTP 客户端** | Axios |
| **WebSocket 客户端** | Node.js 原生 WebSocket |
| **数据服务** | 通过 acat-book-book REST API + acat-book-websocket WebSocket 推送 |
| **进程管理** | Docker（生产环境） |

## 项目结构

```
book-crawler/
├── src/                       # 后端源码
│   ├── server.js              # Express 服务入口
│   ├── config.js              # 应用配置
│   ├── services/
│   │   ├── api-client.js      # REST API 客户端
│   │   ├── ws-client.js       # WebSocket 客户端（直连 WS 服务）
│   │   ├── crawler-data-sender.js  # WS 数据推送层
│   │   ├── crawler.js         # 爬虫核心服务
│   │   └── browser.js         # 共享 Puppeteer 浏览器实例
│   ├── store/
│   │   ├── storage.js         # 数据持久化（API + WS）
│   │   └── crawl-tracker.js   # 爬取状态本地追踪
│   ├── sites/
│   │   ├── SiteAdapter.js     # 站点适配器基类
│   │   ├── registry.js        # 适配器注册表
│   │   ├── site-69shuba.js    # 69shuba 适配器
│   │   └── site-alicesw.js    # alicesw 适配器
│   └── routes/
│       └── crawler.js         # API 路由
├── frontend/                  # React 前端
│   ├── src/
│   │   ├── App.tsx            # 主界面组件
│   │   └── main.tsx           # 入口文件
│   ├── index.html
│   ├── vite.config.ts         # Vite 配置（含 API 代理）
│   └── package.json
├── docs/                      # 项目文档
├── Dockerfile
├── .github/workflows/         # GitHub Actions CI/CD
│   └── ci.yml
└── package.json
```

## 架构

```
book-crawler (Node.js)
    │
    ├── WebSocket (直连, 不走网关)
    │   └── ws://websocket-service:9005/ws/crawler?token=xxx
    │       推送: push_book / push_chapter / push_paragraphs / task_status
    │       订阅: ws:crawler:book:result / ws:crawler:chapter:result
    │
    ├── REST (通过 API 网关)
    │   ├── GET  /api/book/crawler/authors?match=...    查询/匹配作者
    │   ├── GET  /api/book/crawler/categories?match=... 查询/匹配分类
    │   ├── GET  /api/book/crawler/tags?match=...       查询/匹配标签
    │   ├── GET  /api/book/crawler/books?title=&author= 查询/匹配书籍
    │   ├── POST /api/book/crawler/authors              创建作者
    │   ├── POST /api/book/crawler/categories           创建分类
    │   ├── POST /api/book/crawler/tags                 创建标签
    │   ├── POST /api/book/crawler/books                创建书籍（含标签关联）
    │   ├── POST /api/book/crawler/chapters             创建章节（回退用）
    │   └── POST /api/book/file/upload                  上传封面图片
    │
    └── 本地文件 (data/crawls/)
        └── 爬取状态追踪（已爬取/失败章节记录）

## 快速开始

### 环境要求

- Node.js ≥ 18.0.0
- 后端 API 服务（acat-book-gateway + 各微服务已运行）

### 安装

```bash
# 1. 安装后端依赖
npm install

# 2. 安装前端依赖并构建
cd frontend && npm install && npm run build && cd ..
```

### 开发模式

```bash
# 启动后端（自动重启，监听文件变更）
npm run dev

# 新终端：启动前端开发服务器（热更新）
npm run dev:frontend
```

- 后端: http://localhost:8001
- 前端: http://localhost:5175（自动代理 /api → 8001）

### 生产模式

```bash
# 1. 构建前端
cd frontend && npm run build && cd ..

# 2. 启动服务
npm start
```

访问 http://localhost:8001 即可使用。

## API 接口

### 1. 搜索书籍

```
GET /api/crawler/search?keyword={关键词}&page={页码}
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| keyword | string | 是 | - | 书名或作者关键词 |
| page | number | 否 | 0 | 页码，从 0 开始，每页 10 条 |

响应示例：
```json
[
  {
    "title": "赘婿",
    "url": "https://www.69shuba.com/book/12345.htm",
    "snippet": "愤怒的香蕉所著小说赘婿..."
  }
]
```

### 2. 爬取书籍

```
POST /api/crawler/crawl
Content-Type: application/json

{ "url": "https://www.69shuba.com/book/12345.htm" }
```

响应示例：
```json
{
  "success": true,
  "message": "爬取完成",
  "title": "赘婿",
  "author": "愤怒的香蕉",
  "category": "历史",
  "bookId": 1234567890,
  "chapterCount": 1200,
  "crawledChapters": 1200
}
```

### 3. 爬取单个章节

```
POST /api/crawler/crawl-chapter?url={章节URL}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8001` | 服务端口 |
| `API_BASE_URL` | `http://localhost:9000` | API 网关地址（REST 调用） |
| `CRAWLER_API_BASE_URL` | 同 `API_BASE_URL` | Crawler API 地址（默认同网关） |
| `API_TIMEOUT` | `30000` | HTTP 请求超时 ms |
| `CRAWLER_USERNAME` | `crawler` | 后端登录用户名 |
| `CRAWLER_PASSWORD` | `123456` | 后端登录密码 |
| `CRAWLER_USER_ID` | `4` | 爬虫用户 ID |
| **WebSocket** | | |
| `WS_URL` | `ws://localhost:9005` | WebSocket 服务直连地址（不走网关） |
| `CRAWLER_WS_TOKEN` | — | 爬虫 WS 认证 Token（必填） |
| `WS_RECONNECT_MS` | `5000` | WS 重连间隔基准值 ms |
| `GOOGLE_SEARCH_URL` | `https://www.google.com/search` | Google 搜索地址 |

## 部署

项目通过 GitHub Actions 自动构建 Docker 镜像并部署。宿主机仅需 Docker + Git。

```bash
# 手动部署（备选）
# 1. 构建镜像
docker build -t book-crawler:latest .

# 2. 启动容器
docker run -d --name book-crawler --network host --restart unless-stopped \
  -v /opt/book-crawler-data:/app/data \
  -e NODE_ENV=production -e PORT=8001 \
  -e API_BASE_URL=http://localhost:9000 -e API_TIMEOUT=30000 \
  -e CRAWLER_USERNAME=crawler -e CRAWLER_PASSWORD=123456 \
  -e WS_URL=ws://localhost:9005 \
  book-crawler:latest
```

详见 [部署指南](docs/部署指南.md)。

## WebSocket 接口

爬虫通过 WebSocket 直连 `acat-book-websocket` 服务（端口 9005）推送章节数据，详情参见 [WEBSOCKET_API.md](../acat-fun/acat-parent/acat-book-parent/acat-book-websocket/docs/WEBSOCKET_API.md)。
