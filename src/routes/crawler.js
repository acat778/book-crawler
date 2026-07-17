import { Router } from 'express';
import { crawlerService } from '../services/crawler.js';
import { listSites } from '../sites/registry.js';
import { listTaskLogs } from '../persistence/task-log-repository.js';
import { subscribeTaskEvents, subscribeTaskLogs } from '../realtime/task-events.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', adapters: listSites().map(({ id }) => id) });
});

function toTaskSummary(record) {
  if (record.totalChapters != null) return record;
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
    site: record.site,
    totalChapters: totalCount,
    crawledChapters: crawledCount,
    failedChapters: failedCount,
    pendingChapters: Math.max(0, totalCount - crawledCount - failedCount),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function openEventStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': connected\n\n');
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
  return (unsubscribe) => req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
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

    const result = await crawlerService.search(keyword.trim(), parseInt(page, 10) || 0, site);
    const { results = [], hasMore = false, outcome = results.length ? 'results' : 'empty', failures = [] } = result;
    if (outcome === 'unavailable') return res.status(503).json({ outcome, results: [], hasMore: false, error: { code: 'SEARCH_UNAVAILABLE', message: '搜索不可用' }, failures });
    res.json({ outcome, results, hasMore });
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

router.get('/events', (req, res) => {
  const closeWith = openEventStream(req, res);
  closeWith(subscribeTaskEvents((event) => res.write(`data: ${JSON.stringify(event)}\n\n`)));
});

router.get('/tasks/:bookId/logs', async (req, res) => {
  try {
    res.json(await listTaskLogs(req.params.bookId, req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks/:bookId/logs/stream', (req, res) => {
  const closeWith = openEventStream(req, res);
  closeWith(subscribeTaskLogs(req.params.bookId, (log) => res.write(`data: ${JSON.stringify(log)}\n\n`)));
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
 * 重新爬取一本书（清理全部章节正文和 crawler 记录后从头爬取）
 * Body: { bookId: string, url: string, site?: string }
 */
router.post('/re-crawl', async (req, res) => {
  try {
    const { bookId, url, site } = req.body;

    if (!bookId || !url) {
      return res.status(400).json({ error: 'bookId 和 url 参数不能为空' });
    }

    await crawlerService.storage.prepareBookRecrawl(String(bookId));
    await crawlerService.storage.deleteCrawlRecord(bookId);
    console.log(`[API] 已清理章节内容和爬取记录: bookId=${bookId}`);

    // 触发爬取
    const result = await crawlerService.crawl(url.trim(), 0, site);
    res.json(result);
  } catch (err) {
    console.error('[API] /re-crawl 错误:', err.message);
    res.status(500).json({ error: '重新爬取失败: ' + err.message });
  }
});

/**
 * POST /api/crawler/tasks/:bookId/recrawl
 * 使用任务保存的来源地址执行全本重爬。
 */
router.post('/tasks/:bookId/recrawl', async (req, res) => {
  try {
    const { bookId } = req.params;
    const record = await crawlerService.storage.getCrawlRecord(bookId);
    if (!record?.url) {
      return res.status(404).json({ error: '爬取记录或来源地址不存在' });
    }
    const removedChapters = await crawlerService.storage.prepareBookRecrawl(bookId);
    await crawlerService.storage.deleteCrawlRecord(bookId);
    const result = await crawlerService.crawl(record.url, 0, record.site || req.body?.site);
    res.json({ ...result, removedChapters });
  } catch (err) {
    console.error('[API] /tasks/:bookId/recrawl 错误:', err.message);
    res.status(500).json({ error: '全本重新爬取失败: ' + err.message });
  }
});

/**
 * POST /api/crawler/tasks/:bookId/retry
 * 重试爬取失败的章节（保留已成功的章节，只重试失败的）
 * Body: { url: string, site?: string }
 */
router.post('/tasks/:bookId/retry', async (req, res) => {
  try {
    const { bookId } = req.params;
    const { site } = req.body;

    if (!bookId) {
      return res.status(400).json({ error: 'bookId 参数不能为空' });
    }

    const record = await crawlerService.storage.getCrawlRecord(bookId);
    if (!record) {
      return res.status(404).json({ error: '爬取记录不存在，请使用 /crawl 或 /re-crawl 开始新爬取' });
    }

    const failedChapters = (record.chapters || []).filter(ch => ch.status === 'failed');
    if (failedChapters.length === 0) {
      return res.json({ message: '没有失败的章节需要重试', bookId, retried: 0 });
    }

    console.log(`[API] 重试失败章节: bookId=${bookId}, count=${failedChapters.length}`);

    // 更新状态为重试中
    record.status = 'crawling';
    record.updatedAt = new Date().toISOString();
    await crawlerService.storage.writeCrawlRecord(bookId, record);

    // 逐章重试
    let retriedCount = 0;
    for (const chapter of failedChapters) {
      try {
        console.log(`[API] 重试章节: ${chapter.title} (${chapter.url})`);
        await crawlerService.storage.prepareChapterRecrawl(chapter.id);
        const paragraphs = await crawlerService.crawlChapterContent(chapter.url, null, site || record.site);

        if (paragraphs.length > 0) {
          const wordCount = paragraphs.reduce((sum, p) => sum + p.length, 0);
          const newChapter = await crawlerService.storage.createChapterWithContent(
            bookId, chapter.title, paragraphs, chapter.sortOrder,
          );

          // 更新记录：移除旧失败记录，添加新成功记录
          const existingRecord = await crawlerService.storage.getCrawlRecord(bookId);
          if (existingRecord) {
            existingRecord.chapters = (existingRecord.chapters || []).filter(c => c.url !== chapter.url);
            existingRecord.chapters.push({
              id: newChapter.id,
              title: chapter.title,
              url: chapter.url,
              sortOrder: chapter.sortOrder,
              status: 'crawled',
              wordCount,
            });
            existingRecord.updatedAt = new Date().toISOString();
            await crawlerService.storage.writeCrawlRecord(bookId, existingRecord);
          }
          retriedCount++;
        } else {
          console.warn(`[API] 重试章节正文仍为空: ${chapter.title}`);
        }
      } catch (err) {
        console.warn(`[API] 重试章节失败: ${chapter.title} - ${err.message}`);
      }
    }

    // 更新最终状态
    const finalRecord = await crawlerService.storage.getCrawlRecord(bookId);
    if (finalRecord) {
      const remainingFailed = (finalRecord.chapters || []).filter(c => c.status === 'failed').length;
      finalRecord.status = remainingFailed > 0 ? 'failed' : 'completed';
      finalRecord.updatedAt = new Date().toISOString();
      await crawlerService.storage.writeCrawlRecord(bookId, finalRecord);
    }

    console.log(`[API] 重试完成: bookId=${bookId}, retried=${retriedCount}/${failedChapters.length}`);
    res.json({
      message: `重试完成，${retriedCount}/${failedChapters.length} 个章节重试成功`,
      bookId,
      retried: retriedCount,
      total: failedChapters.length,
    });
  } catch (err) {
    console.error('[API] /tasks/:bookId/retry 错误:', err.message);
    res.status(500).json({ error: '重试失败: ' + err.message });
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
