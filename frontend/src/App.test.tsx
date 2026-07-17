import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

describe('搜索终态', () => {
  it('全来源受限时显示搜索不可用并清理旧结果', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/tasks')) return Promise.resolve(new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify({
      outcome: 'unavailable', results: [], hasMore: false,
      error: { code: 'SEARCH_UNAVAILABLE', message: '搜索不可用' },
      failures: [{ source: 'duckduckgo_html', category: 'challenge' }],
      }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    }))
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('输入书名或作者关键词...'), { target: { value: '龙族' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(await screen.findByText('搜索不可用')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('搜索来源触发验证')
  })
})

describe('任务重爬', () => {
  it('为失败章节和全本重爬提供独立操作', async () => {
    const task = {
      bookId: 'book-1', title: '测试书籍', authorName: '作者', url: 'https://example.com/book/1',
      site: '69shuba', status: 'completed', totalChapters: 2, crawledChapters: 1,
      failedChapters: 1, pendingChapters: 0, createdAt: '2026-07-17T00:00:00Z', updatedAt: '2026-07-17T00:00:00Z',
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/tasks') && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({ tasks: [task] }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '任务 (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: '重爬失败章节' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/crawler/tasks/book-1/retry', expect.objectContaining({ method: 'POST' }),
    ))

    fireEvent.click(await screen.findByRole('button', { name: '全本重爬' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/crawler/tasks/book-1/recrawl', expect.objectContaining({ method: 'POST' }),
    ))
  })
})
