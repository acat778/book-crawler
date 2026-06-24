/**
 * 爬取状态追踪 — 本地文件存储
 *
 * 每本书一个 JSON 文件，存储在 data/crawls/ 目录下。
 *
 * 文件结构:
 *   data/crawls/{bookId}.json
 *
 * 数据结构:
 *   {
 *     bookId: string,
 *     title: string,
 *     authorName: string,
 *     url: string,
 *     status: 'pending' | 'crawling' | 'completed' | 'failed',
 *     catalogUrl: string,
 *     chapterLinks: Array<{ title: string, url: string, sortOrder: number }>,
 *     chapters: Array<{ id: string, title: string, url: string, sortOrder: number, status: 'crawled' | 'failed', wordCount: number }>,
 *     createdAt: string (ISO),
 *     updatedAt: string (ISO)
 *   }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'crawls');

/**
 * 确保 data/crawls 目录存在
 */
async function ensureDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch { /* directory exists */ }
}

/**
 * 获取某本书的追踪文件路径
 * @param {string} bookId
 * @returns {string}
 */
function filePath(bookId) {
  return path.join(DATA_DIR, `${bookId}.json`);
}

/**
 * 读取爬取记录
 * @param {string} bookId
 * @returns {Promise<object|null>}
 */
async function readRecord(bookId) {
  try {
    const raw = await fs.readFile(filePath(bookId), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 写入爬取记录
 * @param {string} bookId
 * @param {object} data
 */
async function writeRecord(bookId, data) {
  await ensureDir();
  await fs.writeFile(filePath(bookId), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 初始化书籍爬取记录
 *
 * 若记录已存在（例如之前中断），返回已有记录用于恢复爬取。
 * 若不存在，创建新记录并写入 chapterLinks（目录快照）。
 *
 * @param {string} bookId - 书籍 ID
 * @param {string} title - 书名
 * @param {string} authorName - 作者名
 * @param {string} url - 书籍 URL
 * @param {string} catalogUrl - 目录页 URL
 * @param {Array<{title: string, url: string, sortOrder: number}>} chapterLinks - 完整章节列表
 * @returns {Promise<object>} 爬取记录
 */
export async function initCrawlRecord(bookId, title, authorName, url, catalogUrl, chapterLinks) {
  const existing = await readRecord(bookId);
  if (existing) {
    console.log(`[CrawlTracker] 爬取记录已存在: bookId=${bookId}, status=${existing.status}`);
    return existing;
  }

  const now = new Date().toISOString();
  const doc = {
    bookId,
    title,
    authorName,
    url,
    status: 'pending',
    catalogUrl,
    chapterLinks: chapterLinks.map((ch, i) => ({
      title: ch.title,
      url: ch.url,
      sortOrder: ch.sortOrder !== undefined ? ch.sortOrder : i + 1,
    })),
    chapters: [],
    createdAt: now,
    updatedAt: now,
  };

  await writeRecord(bookId, doc);
  console.log(`[CrawlTracker] 爬取记录已创建: bookId=${bookId}, chapters=${chapterLinks.length}`);
  return doc;
}

/**
 * 更新书籍爬取整体状态
 * @param {string} bookId
 * @param {'crawling'|'completed'|'failed'} status
 */
export async function updateCrawlBookStatus(bookId, status) {
  const record = await readRecord(bookId);
  if (!record) {
    console.warn(`[CrawlTracker] 爬取记录不存在，无法更新状态: bookId=${bookId}`);
    return;
  }
  record.status = status;
  record.updatedAt = new Date().toISOString();
  await writeRecord(bookId, record);
}

/**
 * 追加一个已爬取/失败的章节记录
 * @param {string} bookId
 * @param {string} chapterId - 章节 ID（API 创建后返回）
 * @param {string} title - 章节标题
 * @param {string} url - 章节 URL
 * @param {number} sortOrder - 排序序号
 * @param {'crawled'|'failed'} status - 爬取状态
 * @param {number} [wordCount=0] - 字数（成功时）
 */
export async function appendCrawlChapter(bookId, chapterId, title, url, sortOrder, status, wordCount = 0) {
  const record = await readRecord(bookId);
  if (!record) {
    console.warn(`[CrawlTracker] 爬取记录不存在，无法追加章节: bookId=${bookId}`);
    return;
  }
  record.chapters.push({
    id: chapterId,
    title,
    url,
    sortOrder,
    status,
    wordCount,
  });
  record.updatedAt = new Date().toISOString();
  await writeRecord(bookId, record);
}

/**
 * 获取爬取记录
 * @param {string} bookId
 * @returns {Promise<object|null>}
 */
export async function getCrawlRecord(bookId) {
  return readRecord(bookId);
}

/**
 * 删除爬取记录（用于重新爬取）
 * @param {string} bookId
 */
export async function deleteCrawlRecord(bookId) {
  try {
    await fs.unlink(filePath(bookId));
    console.log(`[CrawlTracker] 爬取记录已删除: bookId=${bookId}`);
  } catch {
    // 文件不存在，无需处理
  }
}

/**
 * 获取某书籍已成功爬取的章节 URL 集合（用于跳过已完成章节）
 * @param {string} bookId
 * @returns {Promise<Set<string>>}
 */
export async function getCrawledChapterUrls(bookId) {
  const record = await readRecord(bookId);
  if (!record || !record.chapters) return new Set();
  return new Set(
    record.chapters
      .filter(ch => ch.status === 'crawled')
      .map(ch => ch.url),
  );
}
