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

**成功响应（HTTP 200）**：`outcome` 只有 `results` 或 `empty`。`results` 表示至少一个来源返回通过 URL/标题校验的结果；`empty` 表示至少一个来源正常完成但没有匹配。来源按 HTML 后 Lite 合并并以 canonical URL 去重。
```json
{
  "outcome": "results",
  "results": [
    { "title": "赘婿", "url": "https://...", "snippet": "简介..." }
  ],
  "hasMore": true
}
```

**搜索不可用（HTTP 503）**：所有来源均失败时返回，不得当作成功空结果。请求总截止时间为 12 秒；69 书吧直连仅用于受限探测，不绕过 Cloudflare/challenge。

```json
{
  "outcome": "unavailable",
  "results": [],
  "hasMore": false,
  "error": { "code": "SEARCH_UNAVAILABLE", "message": "搜索不可用" },
  "failures": [{ "source": "duckduckgo_html", "category": "challenge" }]
}
```

`category` 仅为 `site_restricted`、`challenge`、`timeout`、`abnormal_response`；响应和日志不包含 Cookie、token 或外部正文。参数校验失败仍为 HTTP 400，内部合同错误为脱敏 HTTP 500。

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
      "site": "69shuba",
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

## 5. 重爬失败章节

```
POST /api/crawler/tasks/{bookId}/retry
Content-Type: application/json

{ "site": "69shuba" }
```

只处理任务中状态为 `failed` 的章节。每章开始前先将旧章节设为草稿，再删除 MySQL 章节元数据和 MongoDB 正文；重新抓取成功后创建并发布新章节，失败时保持不可见。

## 6. 全本重新爬取

任务页使用保存的来源地址：

```
POST /api/crawler/tasks/{bookId}/recrawl
Content-Type: application/json

{ "site": "69shuba" }
```

兼容入口：

```
POST /api/crawler/re-crawl
Content-Type: application/json

{ "bookId": "uuid", "url": "https://...", "site": "69shuba" }
```

全本重爬会先隐藏并软删除该书全部 MySQL 章节，删除 MongoDB 正文和本地任务记录，再按最新目录重建。书籍元数据和封面保留。

## 7. 查询爬取状态

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
