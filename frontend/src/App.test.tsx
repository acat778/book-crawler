import { fireEvent, render, screen } from '@testing-library/react'
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
