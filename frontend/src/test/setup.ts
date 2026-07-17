import '@testing-library/jest-dom/vitest'

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(_url: string | URL) {}

  close() {}
}

Object.defineProperty(globalThis, 'EventSource', {
  configurable: true,
  writable: true,
  value: MockEventSource,
})
