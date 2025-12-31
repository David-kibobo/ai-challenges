import { vi, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { FetchInterceptor } from '../../../../src/interceptors/fetch/index.ts'
import stream from 'node:stream'
import { Buffer } from 'node:buffer'

const TEST_URL = 'https://api.example.com/slow-stream'
const interceptor = new FetchInterceptor()

beforeAll(() => {
  interceptor.apply()
})

afterAll(() => {
  interceptor.dispose()
})

afterEach(() => {
  vi.useRealTimers()
  interceptor.removeAllListeners()
})

it('should abort a slow mock response stream mid-consumption and propagate the custom reason', async () => {
  vi.useFakeTimers()
  const CHUNK_DELAY_MS = 100
  const CUSTOM_REASON = 'Manual Abort Test: Stream Cancelled'
  let streamDestroyed = false

  const abortController = new AbortController()

  interceptor.once('request', ({ controller }) => {
    const readableNode = new stream.Readable({
      read() {
        setTimeout(() => { if (!this.destroyed) this.push(Buffer.from('chunk')) }, CHUNK_DELAY_MS)
      },
    })
    readableNode.on('close', () => { streamDestroyed = true })
    controller.respondWith(new Response(stream.Readable.toWeb(readableNode) as any))
  })

  const response = await fetch(TEST_URL, { signal: abortController.signal })
  const reader = response.body!.getReader()

  await vi.advanceTimersByTimeAsync(CHUNK_DELAY_MS + 10)
  await reader.read()

  abortController.abort(new DOMException(CUSTOM_REASON, 'AbortError'))


  await vi.advanceTimersByTimeAsync(CHUNK_DELAY_MS + 10)

  let error: any
  try {
    await reader.read()
  } catch (e) {
    error = e
  } finally {
    reader.releaseLock()
  }

  expect(error).toBeDefined()
  expect(error.name).toBe('AbortError')
  expect(streamDestroyed).toBe(true)
})

it('should propagate the exact custom reason object (identity check)', async () => {
  vi.useFakeTimers()
  const CUSTOM_ERROR = new Error('Unique Identity Error')
  let streamDestroyed = false

  interceptor.once('request', ({ controller }) => {
    const readableNode = new stream.Readable({
      read() {
        setTimeout(() => { if (!this.destroyed) this.push(Buffer.from('chunk')) }, 100)
      },
    })
    readableNode.on('close', () => { streamDestroyed = true })
    controller.respondWith(new Response(stream.Readable.toWeb(readableNode) as any))
  })

  const abortController = new AbortController()
  const response = await fetch(TEST_URL, { signal: abortController.signal })
  const reader = response.body!.getReader()

  await vi.advanceTimersByTimeAsync(110)
  await reader.read()

  abortController.abort(CUSTOM_ERROR)
  await vi.advanceTimersByTimeAsync(110)

  let caughtError: any
  try {
    await reader.read()
  } catch (e) {
    caughtError = e
  } finally {
    reader.releaseLock()
  }

  expect(caughtError).toBe(CUSTOM_ERROR)
  expect(streamDestroyed).toBe(true)
})

it('should propagate a default AbortError when no reason is provided', async () => {
  vi.useFakeTimers()
  let streamDestroyed = false

  interceptor.once('request', ({ controller }) => {
    const readableNode = new stream.Readable({
      read() {
        setTimeout(() => { if (!this.destroyed) this.push(Buffer.from('chunk')) }, 100)
      },
    })
    readableNode.on('close', () => { streamDestroyed = true })
    controller.respondWith(new Response(stream.Readable.toWeb(readableNode) as any))
  })

  const abortController = new AbortController()
  const response = await fetch(TEST_URL, { signal: abortController.signal })
  const reader = response.body!.getReader()

  await vi.advanceTimersByTimeAsync(110)
  await reader.read()

  abortController.abort()
  await vi.advanceTimersByTimeAsync(110)

  let caughtError: any
  try {
    await reader.read()
  } catch (e) {
    caughtError = e
  } finally {
    reader.releaseLock()
  }

  expect(caughtError).toBeDefined()
  expect(caughtError.name).toBe('AbortError')
  expect(streamDestroyed).toBe(true)
})
