# Book Crawler — 书籍爬虫工具

通过 Google 搜索 [69shuba.com](https://www.69shuba.com) 书籍，自动提取书名、作者、分类、目录，并将章节内容存入数据库。

> 本项目由 Spring Boot + Java 原版重构为 **Node.js + Express + React** 前后端一体化项目。

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Node.js ≥ 18 |
| **后端框架** | Express 4.x |
| **前端框架** | React 19 + TypeScript |
| **构建工具** | Vite 8.x |
| **HTML 解析** | Cheerio（服务端 jQuery） |
| **HTTP 客户端** | Axios |
| **关系型数据库** | MySQL 8.x（书籍、作者、章节、字典） |
| **文档数据库** | MongoDB 6.x（章节段落内容） |
| **进程管理** | PM2（生产环境） |

## 项目结构

```
book-crawler/
├── server.js                  # Express 服务入口
├── config.js                  # 应用配置
├── package.json               # 后端依赖
├── ecosystem.config.cjs       # PM2 部署配置
├── db/
│   ├── mysql.js               # MySQL 连接池 + 查询工具
│   └── mongodb.js             # MongoDB 连接 + 段落存储
├── services/
│   ├── crawler.js             # 爬虫核心服务
│   └── google-search.js       # Google 搜索服务
├── routes/
│   └── crawler.js             # API 路由
└── frontend/                  # React 前端
    ├── src/
    │   ├── App.tsx            # 主界面组件
    │   └── main.tsx           # 入口文件
    ├── index.html
    ├── vite.config.ts         # Vite 配置（含 API 代理）
    └── package.json
```

## 快速开始

### 环境要求

- Node.js ≥ 18.0.0
- MySQL 数据库（已创建 `acat_dev` 库及对应表结构）
- MongoDB 数据库

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
| `MYSQL_HOST` | `192.168.250.50` | MySQL 主机 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | `root` | MySQL 用户名 |
| `MYSQL_PASSWORD` | `root` | MySQL 密码 |
| `MYSQL_DATABASE` | `acat_dev` | MySQL 数据库名 |
| `MONGODB_HOST` | `192.168.250.51` | MongoDB 主机 |
| `MONGODB_PORT` | `27017` | MongoDB 端口 |
| `MONGODB_DATABASE` | `acat_dev` | MongoDB 数据库名 |
| `GOOGLE_SEARCH_URL` | `https://www.google.com/search` | Google 搜索地址 |
| `BASE_URL` | `https://www.69shuba.com` | 目标网站 |

## 部署

```bash
# 1. 安装 PM2
npm install -g pm2

# 2. 使用 PM2 启动
pm2 start ecosystem.config.cjs

# 3. 设置开机自启
pm2 save
pm2 startup
```

## 数据库表结构

### MySQL

| 表名 | 说明 |
|------|------|
| `t_book` | 书籍主表 |
| `t_book_user_author` | 作者表 |
| `t_book_chapter` | 章节表 |
| `t_book_dict` | 字典表 |
| `t_book_dict_data` | 字典数据项表 |

### MongoDB

| 集合 | 文档结构 |
|------|----------|
| `paragraphs` | `{ bookId: Long, chapterId: Long, paragraphs: [String] }` |

## 与 Java 原版对比

| 特性 | Java 原版 | Node.js 版 |
|------|-----------|------------|
| 框架 | Spring Boot 3.4 | Express 4.x |
| HTML 解析 | HtmlUnit (XPath) | Cheerio (CSS Selector) |
| ORM | MyBatis-Plus | 原生 SQL (mysql2) |
| MongoDB | Spring Data MongoDB | mongodb 原生驱动 |
| 前端 | React + Vite（独立项目）| React + Vite（同一项目） |
| 部署 | Maven + JAR | Node.js + PM2 |
| 端口 | 9005 | 8001 |
