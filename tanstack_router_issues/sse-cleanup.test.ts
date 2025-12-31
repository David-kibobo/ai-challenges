/**
 * @vitest-environment node
 */
import { setupServer } from 'msw/node'
import { sse } from 'msw'
import { test, expect, vi } from 'vitest'

function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

test('does not log events from closed SSE connections', async () => {
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
    // First connection: emits messages with clientId A, closes itself after 50ms
    server.use(
      sse('http://localhost/stream', ({ client }) => {
        let count = 0
        const timer = setInterval(() => {
          client.send({ data: { clientId: 'A', n: ++count } })
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

        // Do not return a cleanup function from the resolver. Tests clear
        // timers explicitly to avoid scheduling after teardown.
      }),
    )

    // Trigger the SSE request by issuing a fetch with the SSE accept header.
    void fetch('http://localhost/stream', { headers: { accept: 'text/event-stream' } }).catch(() => void 0)

    // Let the first connection run and close.
    await wait(120)

    // Second connection: emits messages with clientId B
    server.use(
      sse('http://localhost/stream', ({ client }) => {
        let count = 0
        const timer = setInterval(() => {
          client.send({ data: { clientId: 'B', n: ++count } })
        }, 10)
        timers.push(timer)

        const closeTimeout = setTimeout(() => {
          client.close()
          clearInterval(timer)
        }, 50)
        timeouts.push(closeTimeout)

        // Do not return a cleanup function from the resolver.
      }),
    )

    void fetch('http://localhost/stream', { headers: { accept: 'text/event-stream' } }).catch(() => void 0)

    // Allow the second connection to emit some events.
    await wait(120)

    const logs = captured.join('\n')

    const sawB = /"clientId":"B"|B/.test(logs)
    const sawA = /"clientId":"A"|A/.test(logs)

    expect(sawB).toBe(true)
    // The correct behavior is to NOT see A messages here. This test intentionally
    // fails with the current library behavior until a fix is applied.
    expect(sawA).toBe(false)
  } finally {
    // Clear any timers created by the handlers to avoid tasks running after
    // the test environment is torn down.
    try {
      for (const t of timers) clearInterval(t)
      for (const t of timeouts) clearTimeout(t)
    } catch {
      // noop
    }

    server.close()
    vi.restoreAllMocks()
  }
})
