import { Router } from 'express';
import { crawlerService } from '../services/crawler.js';

const router = Router();

function toTaskSummary(record) {
  const chapters = Array.isArray(record.chapters) ? record.chapters : [];
  const chapterLinks = Array.isArray(record.chapterLinks) ? record.chapterLinks : [];
  const crawledCount = chapters.filter(ch => ch.status === 'crawled').length;
  const failedCount = chapters.filter(ch => ch.status === 'failed').length;
  const totalCount = chapterLinks.length;

  return {
    bookId: record.bookId,
    status: record.status,
    title: record.title,
    authorName: record.authorName,
    url: record.url,
    totalChapters: totalCount,
    crawledChapters: crawledCount,
    failedChapters: failedCount,
    pendingChapters: Math.max(0, totalCount - crawledCount - failedCount),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * GET /api/crawler/search
 * 站内搜索 / DuckDuckGo 站内搜索书籍
 * Query: keyword (必填), page (选填，默认 0), site (选填)
 * Response: { results: Array<{title, url, snippet}>, hasMore: boolean }
 */
router.get('/search', async (req, res) => {
  try {
    const { keyword, page = '0', site } = req.query;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: 'keyword 参数不能为空' });
    }

    const { results, hasMore } = await crawlerService.search(keyword.trim(), parseInt(page, 10) || 0, site);
    res.json({ results, hasMore });
  } catch (err) {
    console.error('[API] /search 错误:', err.message);
    res.status(500).json({ error: '搜索失败: ' + err.message });
  }
});

/**
 * POST /api/crawler/crawl
 * 爬取一本书的完整信息（含目录和章节内容）
 * Body: { url: string, maxChapters?: number }
 */
router.post('/crawl', async (req, res) => {
  try {
    const { url, maxChapters, site } = req.body;

    if (!url || url.trim() === '') {
      return res.status(400).json({ error: 'url 参数不能为空' });
    }

    const result = await crawlerService.crawl(url.trim(), maxChapters || 0, site);
    res.json(result);
  } catch (err) {
    console.error('[API] /crawl 错误:', err.message);
    res.status(500).json({ error: '爬取失败: ' + err.message });
  }
});

/**
 * GET /api/crawler/tasks
 * 查询本地爬取任务记录。
 */
router.get('/tasks', async (_req, res) => {
  try {
    const records = await crawlerService.storage.listCrawlRecords();
    res.json({ tasks: records.map(toTaskSummary) });
  } catch (err) {
    console.error('[API] /tasks 错误:', err.message);
    res.status(500).json({ error: '查询任务失败: ' + err.message });
  }
});

/**
 * POST /api/crawler/crawl-chapter
 * 爬取单个章节的内容
 * Body: { url: string }
 */
router.post('/crawl-chapter', async (req, res) => {
  try {
    const { url, site } = req.body;

    if (!url || url.trim() === '') {
      return res.status(400).json({ error: 'url 参数不能为空' });
    }

    const paragraphs = await crawlerService.crawlChapterContent(url.trim(), null, site);
    res.json(paragraphs);
  } catch (err) {
    console.error('[API] /crawl-chapter 错误:', err.message);
    res.status(500).json({ error: '爬取章节失败: ' + err.message });
  }
});

/**
 * POST /api/crawler/re-crawl
 * 重新爬取一本书（删除已有 crawler 记录，从头爬取）
 * Body: { bookId: number, url: string }
 */
router.post('/re-crawl', async (req, res) => {
  try {
    const { bookId, url, site } = req.body;

    if (!bookId || !url) {
      return res.status(400).json({ error: 'bookId 和 url 参数不能为空' });
    }

    // 删除爬取记录以强制重新爬取
    await crawlerService.storage.deleteCrawlRecord(bookId);
    console.log(`[API] 已删除爬取记录: bookId=${bookId}`);

    // 触发爬取
    const result = await crawlerService.crawl(url.trim(), 0, site);
    res.json(result);
  } catch (err) {
    console.error('[API] /re-crawl 错误:', err.message);
    res.status(500).json({ error: '重新爬取失败: ' + err.message });
  }
});

/**
 * GET /api/crawler/status/:bookId
 * 查询书籍爬取进度
 */
router.get('/status/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!bookId || bookId.trim() === '') {
      return res.status(400).json({ error: 'bookId 参数不能为空' });
    }

    const record = await crawlerService.storage.getCrawlRecord(bookId);
    if (!record) {
      return res.json({ exists: false });
    }

    res.json({
      exists: true,
      ...toTaskSummary(record),
    });
  } catch (err) {
    console.error('[API] /status 错误:', err.message);
    res.status(500).json({ error: '查询状态失败: ' + err.message });
  }
});

export default router;
