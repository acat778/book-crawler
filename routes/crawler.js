import { Router } from 'express';
import { crawlerService } from '../services/crawler.js';

const router = Router();

/**
 * GET /api/crawler/search
 * 通过 Google 搜索 69shuba.com 上的书籍
 * Query: keyword (必填), page (选填，默认 0)
 */
router.get('/search', async (req, res) => {
  try {
    const { keyword, page = '0' } = req.query;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: 'keyword 参数不能为空' });
    }

    const results = await crawlerService.search(keyword.trim(), parseInt(page, 10) || 0);
    res.json(results);
  } catch (err) {
    console.error('[API] /search 错误:', err.message);
    res.status(500).json({ error: '搜索失败: ' + err.message });
  }
});

/**
 * POST /api/crawler/crawl
 * 爬取一本书的完整信息（含目录和章节内容）
 * Body: { url: string }
 */
router.post('/crawl', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || url.trim() === '') {
      return res.status(400).json({ error: 'url 参数不能为空' });
    }

    const result = await crawlerService.crawl(url.trim());
    res.json(result);
  } catch (err) {
    console.error('[API] /crawl 错误:', err.message);
    res.status(500).json({ error: '爬取失败: ' + err.message });
  }
});

/**
 * POST /api/crawler/crawl-chapter
 * 爬取单个章节的内容
 * Query: url (必填)
 */
router.post('/crawl-chapter', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url || url.trim() === '') {
      return res.status(400).json({ error: 'url 参数不能为空' });
    }

    const paragraphs = await crawlerService.crawlChapterContent(url.trim());
    res.json(paragraphs);
  } catch (err) {
    console.error('[API] /crawl-chapter 错误:', err.message);
    res.status(500).json({ error: '爬取章节失败: ' + err.message });
  }
});

export default router;
