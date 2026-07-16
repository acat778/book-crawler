import { useEffect, useRef, useState } from 'react';

type SiteId = '69shuba' | 'alicesw';
type TabKey = 'search' | 'tasks';

const SITES: { id: SiteId; label: string }[] = [
  { id: '69shuba', label: '69书吧' },
  { id: 'alicesw', label: '爱丽丝书屋' },
];

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchResponse {
  results: SearchResult[];
  hasMore: boolean;
  outcome?: 'results' | 'empty' | 'unavailable';
  failures?: { source: string; category: string }[];
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
  cover?: string;
}

interface CrawlTask {
  bookId: string;
  title: string;
  authorName: string;
  url: string;
  status: string;
  totalChapters: number;
  crawledChapters: number;
  failedChapters: number;
  pendingChapters: number;
  createdAt: string;
  updatedAt: string;
}

interface TasksResponse {
  tasks: CrawlTask[];
}

interface TaskLog { level: string; message: string; time: string }
interface LogPage { list: TaskLog[]; hasMore: boolean; nextBefore: string | null }

const API = '/api/crawler';

const STATUS_MAP: Record<string, { text: string; color: string; background: string; border: string }> = {
  pending: { text: '待开始', color: '#595959', background: '#fafafa', border: '#d9d9d9' },
  crawling: { text: '爬取中', color: '#0958d9', background: '#e6f4ff', border: '#91caff' },
  completed: { text: '已完成', color: '#237804', background: '#f6ffed', border: '#b7eb8f' },
  failed: { text: '失败', color: '#a8071a', background: '#fff1f0', border: '#ffa39e' },
};

const TAB_CONFIG: { key: TabKey; label: string }[] = [
  { key: 'search', label: '搜索书籍' },
  { key: 'tasks', label: '任务' },
];

function getStatusMeta(status: string) {
  return STATUS_MAP[status] || { text: status || '未知', color: '#595959', background: '#fafafa', border: '#d9d9d9' };
}

function formatDate(value?: string) {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 19);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('search');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [crawling, setCrawling] = useState<string | null>(null);
  const [crawlResults, setCrawlResults] = useState<Record<string, CrawlResult>>({});
  const [error, setError] = useState('');
  const [searchOutcome, setSearchOutcome] = useState<'ready' | 'results' | 'empty' | 'unavailable' | 'error'>('ready');
  const [failures, setFailures] = useState<{ source: string; category: string }[]>([]);
  const [selectedSite, setSelectedSite] = useState<SiteId>('69shuba');
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [tasks, setTasks] = useState<CrawlTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [logTask, setLogTask] = useState<CrawlTask | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [logCursor, setLogCursor] = useState<string | null>(null);
  const [logHasMore, setLogHasMore] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchTasks = async () => {
    setTaskError('');
    try {
      const res = await fetch(`${API}/tasks`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TasksResponse = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error('[BookCrawler] 加载任务失败:', err);
      setTaskError('任务加载失败');
    }
  };

  useEffect(() => {
    fetchTasks();
    const source = new EventSource(`${API}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type: 'upsert' | 'delete'; task?: CrawlTask; taskId?: string };
      if (payload.type === 'delete' && payload.taskId) {
        setTasks((current) => current.filter((task) => task.bookId !== payload.taskId));
      } else if (payload.task) {
        setTasks((current) => [payload.task!, ...current.filter((task) => task.bookId !== payload.task!.bookId)]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!logTask) return;
    const source = new EventSource(`${API}/tasks/${logTask.bookId}/logs/stream`);
    source.onmessage = (event) => setLogs((current) => [...current, JSON.parse(event.data) as TaskLog]);
    return () => source.close();
  }, [logTask]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const openLogs = async (task: CrawlTask) => {
    setLoadingLogs(true);
    try {
      const response = await fetch(`${API}/tasks/${task.bookId}/logs?limit=200`);
      const page = await response.json() as LogPage;
      setLogs(page.list || []);
      setLogCursor(page.nextBefore);
      setLogHasMore(page.hasMore);
      setLogTask(task);
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadEarlierLogs = async () => {
    if (!logTask || !logCursor || loadingLogs) return;
    setLoadingLogs(true);
    try {
      const response = await fetch(`${API}/tasks/${logTask.bookId}/logs?limit=200&before=${encodeURIComponent(logCursor)}`);
      const page = await response.json() as LogPage;
      setLogs((current) => [...(page.list || []), ...current]);
      setLogCursor(page.nextBefore);
      setLogHasMore(page.hasMore);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleSearch = async (page = 0) => {
    if (!keyword.trim()) return;
    setSearching(true);
    setError('');
    setSearchOutcome('ready');
    setFailures([]);
    setResults([]);
    setCurrentPage(page);
    try {
      const res = await fetch(`${API}/search?keyword=${encodeURIComponent(keyword)}&page=${page}&site=${selectedSite}`);
      const data: SearchResponse = await res.json();
      if (res.status === 503 || data.outcome === 'unavailable') {
        setSearchOutcome('unavailable'); setFailures(data.failures || []); return;
      }
      setResults(data.results);
      setHasMore(data.hasMore);
      setSearchOutcome(data.outcome || (data.results.length ? 'results' : 'empty'));
    } catch (err) {
      console.error('[BookCrawler] 搜索失败:', err);
      setError('搜索失败');
      setSearchOutcome('error');
    } finally {
      setSearching(false);
    }
  };

  const handleNewSearch = () => {
    setCurrentPage(0);
    handleSearch(0);
  };

  const handleCrawl = async (url: string) => {
    setCrawling(url);
    setError('');
    try {
      const res = await fetch(`${API}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, site: selectedSite }),
      });
      const data: CrawlResult = await res.json();
      setCrawlResults((prev) => ({ ...prev, [url]: data }));
      await fetchTasks();
    } catch (err) {
      console.error('[BookCrawler] 爬取失败:', err);
      setError('爬取失败');
    } finally {
      setCrawling(null);
    }
  };

  const refreshTasks = async () => {
    setLoadingTasks(true);
    await fetchTasks();
    setLoadingTasks(false);
  };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ marginBottom: 8 }}>Book Crawler</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>
          搜索并爬取书籍内容 — 支持多站点切换，自动提取书名、作者、目录并存入数据库
        </p>

        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e8e8e8', marginBottom: 20 }}>
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 18px',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid #1677ff' : '2px solid transparent',
                background: 'transparent',
                color: activeTab === tab.key ? '#1677ff' : '#555',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: activeTab === tab.key ? 600 : 400,
              }}
            >
              {tab.label}{tab.key === 'tasks' ? ` (${tasks.length})` : ''}
            </button>
          ))}
        </div>

        {activeTab === 'search' ? (
          <>
            <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
              {SITES.map((site) => (
                <button
                  key={site.id}
                  onClick={() => { setSelectedSite(site.id); setResults([]); setCurrentPage(0); }}
                  style={{
                    padding: '6px 20px',
                    fontSize: 14,
                    border: `1px solid ${selectedSite === site.id ? '#1677ff' : '#d9d9d9'}`,
                    background: selectedSite === site.id ? '#1677ff' : '#fff',
                    color: selectedSite === site.id ? '#fff' : '#333',
                    cursor: 'pointer',
                    borderRadius: site.id === '69shuba' ? '6px 0 0 6px' : '0 6px 6px 0',
                    borderLeftWidth: site.id === 'alicesw' ? 1 : undefined,
                    fontWeight: selectedSite === site.id ? 600 : 400,
                  }}
                >
                  {site.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNewSearch()}
                placeholder="输入书名或作者关键词..."
                style={{ flex: 1, padding: '8px 12px', fontSize: 14, border: '1px solid #d9d9d9', borderRadius: 6 }}
              />
              <button onClick={handleNewSearch} disabled={searching}
                style={{ padding: '8px 20px', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                {searching ? '搜索中...' : '搜索'}
              </button>
            </div>

            {error && <div role="alert" style={{ color: 'red', marginBottom: 16 }}>搜索失败，请稍后重试</div>}
            {searchOutcome === 'unavailable' && <div role="alert" style={{ color: '#a8071a', marginTop: 60, textAlign: 'center' }}><div>搜索不可用</div>{failures.map((f, i) => <div key={`${f.source}-${f.category}-${i}`}>来源：{({site_restricted:'69书吧受限', challenge:'搜索来源触发验证', timeout:'搜索来源超时', abnormal_response:'搜索来源响应异常'} as Record<string,string>)[f.category] || '搜索来源响应异常'}</div>)}</div>}
            {searchOutcome === 'empty' && !searching && <div role="status" style={{ textAlign: 'center', color: '#999', marginTop: 60 }}>未找到匹配的书籍</div>}

            {results.length > 0 && (
              <div>
                <h3>搜索结果 ({results.length}) {currentPage > 0 && <span style={{ fontWeight: 400, fontSize: 13, color: '#888' }}> — 第 {currentPage + 1} 页</span>}</h3>
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
                            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                              {crawlResults[r.url].cover && crawlResults[r.url].cover !== 'https://static.69shuba.com/images/nocover.jpg' && (
                                <img src={crawlResults[r.url].cover} alt="封面"
                                  style={{ width: 60, height: 80, objectFit: 'cover', borderRadius: 4, border: '1px solid #e8e8e8', flexShrink: 0 }} />
                              )}
                              <div>
                                书名: {crawlResults[r.url].title} | 作者: {crawlResults[r.url].author} | 分类: {crawlResults[r.url].category}
                                <br />
                                书籍ID: {crawlResults[r.url].bookId} | 章节数: {crawlResults[r.url].chapterCount}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 20, marginBottom: 24 }}>
                  <button
                    onClick={() => handleSearch(currentPage - 1)}
                    disabled={currentPage === 0 || searching}
                    style={{
                      padding: '6px 18px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                      border: '1px solid #d9d9d9', background: currentPage === 0 ? '#f5f5f5' : '#fff',
                      color: currentPage === 0 ? '#bbb' : '#333',
                    }}>
                    ← 上一页
                  </button>
                  <span style={{ padding: '6px 12px', fontSize: 13, color: '#666', alignSelf: 'center', minWidth: 80, textAlign: 'center' }}>
                    {searching ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          display: 'inline-block', width: 14, height: 14,
                          border: '2px solid #d9d9d9', borderTopColor: '#1677ff',
                          borderRadius: '50%', animation: 'spin 0.6s linear infinite',
                        }} />
                        加载中...
                      </span>
                    ) : (
                      `第 ${currentPage + 1} 页`
                    )}
                  </span>
                  <button
                    onClick={() => handleSearch(currentPage + 1)}
                    disabled={!hasMore || searching}
                    style={{
                      padding: '6px 18px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                      border: '1px solid #d9d9d9', background: !hasMore ? '#f5f5f5' : '#fff',
                      color: !hasMore ? '#bbb' : '#333',
                    }}>
                    下一页 →
                  </button>
                </div>
              </div>
            )}

            {results.length === 0 && !searching && searchOutcome === 'ready' && (
              <div style={{ textAlign: 'center', color: '#999', marginTop: 60 }}>
                输入关键词搜索书籍
              </div>
            )}
          </>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>爬取任务</h3>
              <button
                onClick={refreshTasks}
                disabled={loadingTasks}
                style={{ padding: '6px 14px', border: '1px solid #d9d9d9', background: '#fff', borderRadius: 6, cursor: 'pointer' }}
              >
                {loadingTasks ? '刷新中...' : '刷新'}
              </button>
            </div>

            {taskError && <div style={{ color: 'red', marginBottom: 16 }}>{taskError}</div>}

            {tasks.length > 0 ? (
              <div style={{ border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                      <th style={{ padding: 12, borderBottom: '1px solid #e8e8e8', width: 110 }}>状态</th>
                      <th style={{ padding: 12, borderBottom: '1px solid #e8e8e8' }}>书籍</th>
                      <th style={{ padding: 12, borderBottom: '1px solid #e8e8e8', width: 160 }}>进度</th>
                      <th style={{ padding: 12, borderBottom: '1px solid #e8e8e8', width: 160 }}>更新时间</th>
                      <th style={{ padding: 12, borderBottom: '1px solid #e8e8e8', width: 130 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => {
                      const statusMeta = getStatusMeta(task.status);
                      const total = task.totalChapters || 0;
                      const done = task.crawledChapters || 0;
                      const percent = total > 0 ? Math.round((done / total) * 100) : 0;

                      return (
                        <tr key={task.bookId}>
                          <td style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              color: statusMeta.color,
                              background: statusMeta.background,
                              border: `1px solid ${statusMeta.border}`,
                              borderRadius: 999,
                              whiteSpace: 'nowrap',
                            }}>
                              {statusMeta.text}
                            </span>
                          </td>
                          <td style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
                            <div style={{ fontWeight: 600 }}>{task.title || task.bookId}</div>
                            <div style={{ color: '#777', marginTop: 4 }}>{task.authorName || '未知作者'}</div>
                          </td>
                          <td style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 6, background: '#f0f0f0', borderRadius: 999, overflow: 'hidden' }}>
                                <div style={{ width: `${percent}%`, height: '100%', background: '#1677ff' }} />
                              </div>
                              <span style={{ color: '#666', minWidth: 56 }}>{done}/{total}</span>
                            </div>
                            {task.failedChapters > 0 && (
                              <div style={{ color: '#a8071a', marginTop: 4 }}>失败 {task.failedChapters} 章</div>
                            )}
                          </td>
                          <td style={{ padding: 12, borderBottom: '1px solid #f0f0f0', color: '#666' }}>
                            {formatDate(task.updatedAt)}
                          </td>
                          <td style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
                            <a href={task.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1677ff', marginRight: 12 }}>打开</a>
                            <button onClick={() => openLogs(task)} style={{ border: 0, padding: 0, background: 'none', color: '#1677ff', cursor: 'pointer' }}>日志</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#999', marginTop: 60 }}>
                暂无爬取任务
              </div>
            )}
          </div>
        )}
      </div>
      {logTask && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div style={{ width: 'min(760px, 90vw)', background: '#fff', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong>日志 - {logTask.title}</strong>
              <button onClick={() => { setLogTask(null); setLogs([]); }} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>
            {logHasMore && <button disabled={loadingLogs} onClick={loadEarlierLogs} style={{ width: '100%', marginBottom: 8 }}>{loadingLogs ? '加载中...' : '加载更早日志'}</button>}
            <div ref={logRef} style={{ maxHeight: 420, overflow: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
              {logs.map((log, index) => (
                <div key={`${log.time}-${index}`} style={{ padding: '3px 0', color: log.level === 'error' ? '#cf1322' : log.level === 'warn' ? '#d46b08' : '#333' }}>
                  <span style={{ color: '#999' }}>{log.time?.slice(11, 19)}</span> {log.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
