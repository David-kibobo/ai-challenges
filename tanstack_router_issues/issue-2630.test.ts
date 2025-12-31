/**
 * @vitest-environment node
 */
import { setupServer } from 'msw/node'
import { sse } from 'msw'
import { test, expect, vi } from 'vitest'

function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

test('does not log events from closed SSE connections (issue #2630)', async () => {
  const captured: string[] = []
  const timers: any[] = []
  const timeouts: any[] = []

  vi.spyOn(console, 'groupCollapsed').mockImplementation((...args: any[]) => {
    try {
      captured.push(String(args[0]))
    } catch {
      captured.push('[groupCollapsed]')
    }
  })
  vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    try {
      captured.push(JSON.stringify(args))
    } catch {
      captured.push('[log]')
    }
  })

  const server = setupServer()

  server.listen()

  try {
    // First connection: emits ping with clientId A, closes itself after 50ms
    server.use(
      sse('http://localhost/stream', ({ client }) => {
        let count = 0
        const timer = setInterval(() => {
          client.send({ event: 'ping', data: { clientId: 'A', n: ++count } })
        }, 10)
        timers.push(timer)

        const closeTimeout = setTimeout(() => {
          // Terminate the connection from the server side
          client.close()
          // Ensure the interval is cleared after close to avoid schedule
          // races that would attempt to enqueue into a closed stream.
          clearInterval(timer)
        }, 50)
        timeouts.push(closeTimeout)

        // Note: the original report described handlers that forget to cleanup.
        // For stable test behavior we still clear the interval when the
        // connection is closed and also make sure the test harness will
        // clear any remaining timers on teardown.
        return () => clearInterval(timer)
      }),
    )

    // Trigger the SSE request (intercepted by msw in node) by creating an
    // EventSource so the `accept: text/event-stream` header is present and
    // the SSE handler's predicate matches.
    void fetch('http://localhost/stream', { headers: { accept: 'text/event-stream' } }).catch(() => void 0)

                client.send({ data: { clientId: 'A', n: ++count } })
    await wait(120)

    // Second connection: emits ping with clientId B
    server.use(
      sse('http://localhost/stream', ({ client }) => {
        let count = 0
        const timer = setInterval(() => {
          client.send({ event: 'ping', data: { clientId: 'B', n: ++count } })
        }, 10)
        timers.push(timer)

        const closeTimeout = setTimeout(() => {
          client.close()
          clearInterval(timer)
        }, 50)
        timeouts.push(closeTimeout)
        return () => clearInterval(timer)
      }),
    )

    void fetch('http://localhost/stream', { headers: { accept: 'text/event-stream' } }).catch(() => void 0)

    // Allow the second connection to emit some events.
    await wait(120)

    const logs = captured.join('\n')

    // We expect to see events from B. We *do not* expect A messages after A
    // connection termination. The current implementation logs A even after close,
    // which should make this test fail until the behavior is fixed.
    const sawB = /"clientId":"B"|B/.test(logs)
    const sawA = /"clientId":"A"|A/.test(logs)
                client.send({ data: { clientId: 'B', n: ++count } })
    expect(sawB).toBe(true)
    // The correct behavior is to NOT see A messages here. The current
    // implementation reproduces the bug and will cause this expectation to fail
    // until fixed.
    expect(sawA).toBe(false)
  } finally {
    // Clear any timers created by the handlers to avoid tasks running after
    // the test environment is torn down.
    try {
      for (const t of timeouts) clearTimeout(t)
    } catch {
      // noop
    }

    server.close()
    vi.restoreAllMocks()
  }
})
