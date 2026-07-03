# acat-book-crawler API 接口

> 爬虫工具对外提供的 HTTP API

## 1. 搜索书籍

```
GET /api/crawler/search?keyword={关键词}&page={页码}&site={站点}
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| keyword | string | 是 | - | 书名或作者关键词 |
| page | number | 否 | 0 | 页码，从 0 开始 |
| site | string | 否 | 69shuba | 站点标识（69shuba / alicesw） |

**响应**：
```json
{
  "results": [
    { "title": "赘婿", "url": "https://...", "snippet": "简介..." }
  ],
  "hasMore": true
}
```

## 2. 爬取书籍

```
POST /api/crawler/crawl
Content-Type: application/json

{ "url": "https://...", "maxChapters": 0, "site": "69shuba" }
```

**响应**：
```json
{
  "success": true,
  "message": "爬取完成",
  "title": "赘婿",
  "author": "愤怒的香蕉",
  "category": "历史",
  "bookId": "uuid",
  "chapterCount": 1200,
  "crawledChapters": 1200
}
```

## 3. 查询爬取任务

```
GET /api/crawler/tasks
```

**说明**：读取本地 `data/crawls/` 中的爬取记录，按更新时间倒序返回，用于前端任务页展示。

**响应**：
```json
{
  "tasks": [
    {
      "bookId": "uuid",
      "status": "completed",
      "title": "赘婿",
      "authorName": "愤怒的香蕉",
      "url": "https://...",
      "totalChapters": 100,
      "crawledChapters": 100,
      "failedChapters": 0,
      "pendingChapters": 0,
      "createdAt": "2026-07-03T12:00:00.000Z",
      "updatedAt": "2026-07-03T12:30:00.000Z"
    }
  ]
}
```

## 4. 爬取单个章节

```
POST /api/crawler/crawl-chapter
Content-Type: application/json

{ "url": "https://...", "site": "69shuba" }
```

## 5. 重新爬取

```
POST /api/crawler/re-crawl
Content-Type: application/json

{ "bookId": "uuid", "url": "https://...", "site": "69shuba" }
```

## 6. 查询爬取状态

```
GET /api/crawler/status/{bookId}
```

**响应**：
```json
{
  "exists": true,
  "bookId": "uuid",
  "status": "crawling",
  "totalChapters": 100,
  "crawledChapters": 45,
  "failedChapters": 2,
  "pendingChapters": 53
}
```
