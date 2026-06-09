import { useState } from 'react';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface CrawlResult {
  success: boolean;
  message: string;
  title: string;
  author: string;
  category: string;
  bookId: number;
  chapterCount: number;
  crawledChapters: number;
}

const API = '/api/crawler';

export default function App() {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [crawling, setCrawling] = useState<string | null>(null);
  const [crawlResults, setCrawlResults] = useState<Record<string, CrawlResult>>({});
  const [error, setError] = useState('');

  const handleSearch = async (page = 0) => {
    if (!keyword.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await fetch(`${API}/search?keyword=${encodeURIComponent(keyword)}&page=${page}`);
      const data = await res.json();
      setResults(data);
    } catch {
      setError('搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const handleCrawl = async (url: string) => {
    setCrawling(url);
    try {
      const res = await fetch(`${API}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data: CrawlResult = await res.json();
      setCrawlResults((prev) => ({ ...prev, [url]: data }));
    } catch {
      setError('爬取失败');
    } finally {
      setCrawling(null);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>Book Crawler</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        通过 Google 搜索 69shuba.com 书籍，点击爬取按钮自动提取书名、作者、目录并存入数据库
      </p>

      {/* 搜索栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="输入书名或作者关键词..."
          style={{ flex: 1, padding: '8px 12px', fontSize: 14, border: '1px solid #d9d9d9', borderRadius: 6 }}
        />
        <button onClick={() => handleSearch()} disabled={searching}
          style={{ padding: '8px 20px', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          {searching ? '搜索中...' : '搜索'}
        </button>
      </div>

      {error && <div style={{ color: 'red', marginBottom: 16 }}>{error}</div>}

      {/* 搜索结果 */}
      {results.length > 0 && (
        <div>
          <h3>搜索结果 ({results.length})</h3>
          {results.map((r) => (
            <div key={r.url} style={{
              border: '1px solid #e8e8e8', borderRadius: 8, padding: 16, marginBottom: 12,
              background: '#fafafa',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 16, fontWeight: 600, color: '#1677ff', textDecoration: 'none' }}>
                    {r.title || '(无标题)'}
                  </a>
                  <div style={{ color: '#888', fontSize: 12, marginTop: 4, wordBreak: 'break-all' }}>{r.url}</div>
                  {r.snippet && <div style={{ color: '#555', fontSize: 13, marginTop: 4 }}>{r.snippet}</div>}
                </div>
                <button
                  onClick={() => handleCrawl(r.url)}
                  disabled={crawling === r.url}
                  style={{
                    marginLeft: 16, padding: '6px 16px', fontSize: 13,
                    background: crawling === r.url ? '#d9d9d9' : '#52c41a',
                    color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>
                  {crawling === r.url ? '爬取中...' : '爬取'}
                </button>
              </div>

              {/* 爬取结果 */}
              {crawlResults[r.url] && (
                <div style={{
                  marginTop: 8, padding: 12, borderRadius: 6,
                  background: crawlResults[r.url].success ? '#f6ffed' : '#fff2f0',
                  border: `1px solid ${crawlResults[r.url].success ? '#b7eb8f' : '#ffccc7'}`,
                }}>
                  <strong>{crawlResults[r.url].success ? '✓ 爬取成功' : '✗ 爬取失败'}</strong>
                  <span style={{ marginLeft: 8, color: '#666' }}>{crawlResults[r.url].message}</span>
                  {crawlResults[r.url].success && (
                    <div style={{ marginTop: 4, fontSize: 13, color: '#555' }}>
                      书名: {crawlResults[r.url].title} | 作者: {crawlResults[r.url].author} | 分类: {crawlResults[r.url].category}
                      <br />
                      书籍ID: {crawlResults[r.url].bookId} | 章节数: {crawlResults[r.url].chapterCount}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && !searching && (
        <div style={{ textAlign: 'center', color: '#999', marginTop: 60 }}>
          输入关键词搜索书籍
        </div>
      )}
    </div>
  );
}
