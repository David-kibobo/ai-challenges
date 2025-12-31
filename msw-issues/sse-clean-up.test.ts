// // test/cleanup-tests/sse/sse-clean-up.node.test.ts
// import { setupServer } from 'msw/node'
// import { sse } from 'msw'
// import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'

// // MSW server
// const server = setupServer()

// beforeAll(() => {
//   server.listen({
//     onUnhandledRequest(req) {
//       // helpful debug when a request isn't matched by MSW
//       // eslint-disable-next-line no-console
//       console.warn('[msw] unhandled request ->', req.url?.href ?? req)
//       return 'bypass'
//     },
//   })
// })
// afterAll(() => server.close())
// afterEach(() => server.resetHandlers())

// /**
//  * Low-level streaming SSE parser. Returns a promise that resolves only when
//  * the fetch ends or is aborted. It delivers parsed events to onEvent.
//  *
//  * Note: this function intentionally does NOT try to resolve on the first
//  * event — the helpers below will call/abort it once the test got what it needs.
//  */
// async function fetchSSE(
//   url: string,
//   onEvent: (data: string, eventName?: string) => void,
//   options?: { signal?: AbortSignal; timeoutMs?: number }
// ) {
//   const timeoutMs = options?.timeoutMs ?? 5000
//   const externalSignal = options?.signal
//   const controller = externalSignal ? null : new AbortController()
//   const signal = externalSignal ?? (controller as AbortController).signal

//   const timer = setTimeout(() => {
//     if (!signal.aborted) (controller as AbortController | null)?.abort()
//   }, timeoutMs)

//   try {
//     const res = await fetch(url, {
//       method: 'GET',
//       headers: { Accept: 'text/event-stream' },
//       signal,
//     })

//     if (!res.body) throw new Error('No response body')

//     const reader = res.body.getReader()
//     const decoder = new TextDecoder('utf-8')
//     let buffer = ''

//     while (true) {
//       const { value, done } = await reader.read()
//       if (done) break
//       buffer += decoder.decode(value, { stream: true })

//       let sepIndex
//       // handle both \n\n and \r\n\r\n separators
//       while ((sepIndex = buffer.indexOf('\n\n')) !== -1 || (sepIndex = buffer.indexOf('\r\n\r\n')) !== -1) {
//         const raw = buffer.slice(0, sepIndex)
//         const sepLen = buffer[sepIndex + 1] === '\r' ? 4 : 2
//         buffer = buffer.slice(sepIndex + sepLen)

//         const lines = raw.split(/\r?\n/)
//         let eventName: string | undefined
//         const dataLines: string[] = []

//         for (const line of lines) {
//           if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
//           else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim())
//         }

//         if (dataLines.length > 0) onEvent(dataLines.join('\n'), eventName)
//       }
//     }
//   } finally {
//     clearTimeout(timer)
//   }
// }

// /** Helper: open a fetchSSE and return a controller + promise of its completion. */
// function openSSE(url: string, onEvent: (d: string, e?: string) => void, opts?: { timeoutMs?: number }) {
//   const controller = new AbortController()
//   const promise = fetchSSE(url, onEvent, { signal: controller.signal, timeoutMs: opts?.timeoutMs })
//   return { controller, promise }
// }

// /** Helper: wait for the first event, then abort the stream and resolve with data. */
// async function waitForFirstEvent(url: string, timeoutMs = 2000) {
//   let got: string | undefined
//   const { controller, promise } = openSSE(
//     url,
//     (data) => {
//       if (got === undefined) {
//         got = data
//         // immediately abort the request so fetchSSE returns quickly
//         try {
//           controller.abort()
//         } catch {}
//       }
//     },
//     { timeoutMs: timeoutMs + 1000 }
//   )

//   // wait for fetchSSE to finish (it will after abort)
//   try {
//     await promise
//   } catch {
//     // abort raises, swallow — we already captured `got`
//   }
//   return got
// }

// /** Helper: wait for N events, then abort and return array */
// async function waitForNEvents(url: string, n: number, timeoutMs = 3000) {
//   const events: string[] = []
//   const { controller, promise } = openSSE(
//     url,
//     (data) => {
//       events.push(data)
//       if (events.length >= n) {
//         try {
//           controller.abort()
//         } catch {}
//       }
//     },
//     { timeoutMs: timeoutMs + 1000 }
//   )

//   try {
//     await promise
//   } catch {
//     // swallow abort
//   }
//   return events
// }

// describe('SSE handler (Node fetch + MSW) — deterministic helpers', () => {
//   const url = 'http://test.msw/stream'

//   test('sends a single event through client.send()', async () => {
//     server.use(
//       sse(url, ({ client }) => {
//         // send a single event, leave stream open or close — doesn't matter,
//         // our helper resolves on first event and aborts.
//         client.send({ event: 'ping', data: '123' })
//       })
//     )

//     const data = await waitForFirstEvent(url, 1500)
//     expect(data).toBe('123')
//   })

//   test('cleans up interval when client.close() is called (client aborts after 2 ticks)', async () => {
//     let cleanupCalled = false
//     server.use(
//       sse(url, ({ client }) => {
//         const iv = setInterval(() => {
//           client.send({ event: 'tick', data: String(Math.random()) })
//         }, 20)
//         return () => {
//           cleanupCalled = true
//           clearInterval(iv)
//         }
//       })
//     )

//     const events = await waitForNEvents(url, 2, 2000)
//     // give server a tiny grace period to run cleanup after aborting the stream
//     await new Promise((r) => setTimeout(r, 40))

//     expect(events.length).toBeGreaterThanOrEqual(2)
//     expect(cleanupCalled).toBe(true)
//   })

//   test('cleanup is called on request.signal abort (fetch + AbortController)', async () => {
//     let cleanupCalled = false
//     server.use(
//       sse(url, ({ request }) => {
//         const iv = setInterval(() => {}, 10)
//         const cleanup = () => {
//           cleanupCalled = true
//           clearInterval(iv)
//         }
//         request.signal.addEventListener('abort', cleanup)
//         return cleanup
//       })
//     )

//     // open the stream and abort from test side
//     const controller = new AbortController()
//     const promise = fetchSSE(url, () => {}, { signal: controller.signal, timeoutMs: 2000 }).catch(() => {})
//     // abort shortly after starting
//     setTimeout(() => controller.abort(), 40)
//     await promise
//     await new Promise((r) => setTimeout(r, 40)) // give handler a moment to run cleanup
//     expect(cleanupCalled).toBe(true)
//   })

//   test('client.error() triggers an error for fetch stream', async () => {
//     server.use(
//       sse(url, ({ client }) => {
//         client.error(new Error('NETWORK_FAIL'))
//       })
//     )

//     let errored = false
//     try {
//       await fetchSSE(url, () => {}, { timeoutMs: 2000 })
//     } catch (err) {
//       errored = true
//     }
//     expect(errored).toBe(true)
//   })
// })
// test/cleanup-tests/sse/sse-clean-up.node.event-driven.test.ts
// test/cleanup-tests/sse/sse-clean-up.node.test.ts
// import { setupServer } from 'msw/node'
// import { sse } from 'msw'
// import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'

// // MSW server
// const server = setupServer()

// beforeAll(() => {
//   server.listen({
//     onUnhandledRequest(req) {
//       // helpful debug when a request isn't matched by MSW
//       // eslint-disable-next-line no-console
//       console.warn('[msw] unhandled request ->', req.url?.href ?? req)
//       return 'bypass'
//     },
//   })
// })
// afterAll(() => server.close())
// afterEach(() => server.resetHandlers())

// /** Minimal SSE fetch reader used by the helpers below. */
// async function fetchSSE(url: string, onEvent: (data: string, eventName?: string) => void, options?: { signal?: AbortSignal; timeoutMs?: number }) {
//   const timeoutMs = options?.timeoutMs ?? 5000
//   const externalSignal = options?.signal
//   const controller = externalSignal ? null : new AbortController()
//   const signal = externalSignal ?? (controller as AbortController).signal

//   const timer = setTimeout(() => {
//     if (!signal.aborted) (controller as AbortController | null)?.abort()
//   }, timeoutMs)

//   try {
//     const res = await fetch(url, { method: 'GET', headers: { Accept: 'text/event-stream' }, signal })
//     if (!res.body) throw new Error('No response body')

//     const reader = res.body.getReader()
//     const decoder = new TextDecoder('utf-8')
//     let buffer = ''

//     while (true) {
//       const { value, done } = await reader.read()
//       if (done) break
//       buffer += decoder.decode(value, { stream: true })

//       let sepIndex
//       while ((sepIndex = buffer.indexOf('\n\n')) !== -1 || (sepIndex = buffer.indexOf('\r\n\r\n')) !== -1) {
//         const raw = buffer.slice(0, sepIndex)
//         const sepLen = buffer[sepIndex + 1] === '\r' ? 4 : 2
//         buffer = buffer.slice(sepIndex + sepLen)

//         const lines = raw.split(/\r?\n/)
//         let eventName: string | undefined
//         const dataLines: string[] = []

//         for (const line of lines) {
//           if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
//           else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim())
//         }

//         if (dataLines.length > 0) onEvent(dataLines.join('\n'), eventName)
//       }
//     }
//   } finally {
//     clearTimeout(timer)
//   }
// }

// /** Open a stream and return controller + promise */
// function openSSE(url: string, onEvent: (d: string, e?: string) => void, opts?: { timeoutMs?: number }) {
//   const controller = new AbortController()
//   const promise = fetchSSE(url, onEvent, { signal: controller.signal, timeoutMs: opts?.timeoutMs })
//   return { controller, promise }
// }

// /** Wait until a given observed array reaches at least `count` elements */
// function waitForObservedCount<T>(observed: T[], count: number, timeoutMs = 3000) {
//   return new Promise<void>((resolve, reject) => {
//     if (observed.length >= count) return resolve()
//     const start = Date.now()
//     const iv = setInterval(() => {
//       if (observed.length >= count) {
//         clearInterval(iv)
//         return resolve()
//       }
//       if (Date.now() - start > timeoutMs) {
//         clearInterval(iv)
//         return reject(new Error('timeout waiting for observed count'))
//       }
//     }, 10)
//   })
// }

// describe('SSE handler (event-driven cleanup tests)', () => {
//   const url = 'http://test.msw/stream'

//   test('events do not leak between handlers (resetHandlers + explicit abort)', async () => {
//     const observed: string[] = []

//     // Handler A: emits event 'A' frequently
//     const aHandler = ({ client }: any) => {
//       const iv = setInterval(() => {
//         try { client.send({ event: 'A', data: 'tick' }) } catch {}
//       }, 20)
//       return () => clearInterval(iv)
//     }

//     // Handler B: emits event 'B' frequently
//     const bHandler = ({ client }: any) => {
//       const iv = setInterval(() => {
//         try { client.send({ event: 'B', data: 'tock' }) } catch {}
//       }, 20)
//       return () => clearInterval(iv)
//     }

//     // Start with handler A
//     server.use(sse(url, aHandler))

//     // Open a single shared client that will observe events across the switch
//     const { controller: controllerA, promise: promiseA } = openSSE(url, (data, ev) => {
//       observed.push(`${String(ev ?? 'message')}:${data}`)
//     }, { timeoutMs: 5000 })

//     // wait for a few A events
//     await waitForObservedCount(observed, 3, 3000)

//     // mark split index and abort the A stream (client-side closes)
//     const splitIndex = observed.length
//     try { controllerA.abort() } catch {}
//     // allow a little time for the server to observe the abort and run cleanup
//     await new Promise((r) => setTimeout(r, 60))

//     // Now replace handlers with B and start a fresh client
//     server.resetHandlers(sse(url, bHandler))

//     const { controller: controllerB, promise: promiseB } = openSSE(url, (data, ev) => {
//       observed.push(`${String(ev ?? 'message')}:${data}`)
//     }, { timeoutMs: 5000 })

//     // wait for a couple B events after the split index
//     await waitForObservedCount(observed, splitIndex + 2, 3000)

//     // stop B
//     try { controllerB.abort() } catch {}
//     await Promise.allSettled([promiseA, promiseB])

//     const pre = observed.slice(0, splitIndex)
//     const post = observed.slice(splitIndex)

//     // pre should contain only A events
//     const preAllA = pre.every((s) => typeof s === 'string' && s.startsWith('A:'))
//     // post should contain at least one B and no A
//     const postHasB = post.some((s) => typeof s === 'string' && s.startsWith('B:'))
//     const postHasA = post.some((s) => typeof s === 'string' && s.startsWith('A:'))

//     // Assertions
//     expect(preAllA).toBe(true)
//     expect(postHasB).toBe(true)
//     expect(postHasA).toBe(false)
//   }, 10000)
// })

// import { setupServer } from 'msw/node'
// import { sse } from 'msw'
// import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'

// const server = setupServer()

// beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
// afterAll(() => server.close())
// afterEach(() => server.resetHandlers())

// describe('SSE deterministic cleanup (A/B handlers)', () => {
//   const url = 'http://test.msw/stream'

//   async function fetchSSEEvents(url: string) {
//     const res = await fetch(url, { headers: { Accept: 'text/event-stream' } })
//     if (!res.body) throw new Error('No response body')

//     const reader = res.body.getReader()
//     const decoder = new TextDecoder()
//     const events: string[] = []

//     while (true) {
//       const { value, done } = await reader.read()
//       if (done) break
//       if (value) {
//         const decoded = decoder.decode(value)
//         // parse data lines from SSE
//         const dataLines = decoded
//           .split(/\r?\n/)
//           .filter(l => l.startsWith('data:'))
//           .map(l => l.slice('data:'.length).trim())
//         events.push(...dataLines)
//       }
//     }

//     return events
//   }

//   test('events do not leak between handlers', async () => {
//     // --- Handler A emits two "tickA" events then closes ---
//     server.use(
//       sse(url, ({ client }) => {
//         client.send({ event: 'message', data: 'tickA1' })
//         client.send({ event: 'message', data: 'tickA2' })
//         client.close() // close after A events
//       })
//     )

//     const aEvents = await fetchSSEEvents(url)
//     expect(aEvents).toEqual(['tickA1', 'tickA2'])

//     // --- Now replace handler with B ---
//     server.resetHandlers(
//       sse(url, ({ client }) => {
//         client.send({ event: 'message', data: 'tickB1' })
//         client.send({ event: 'message', data: 'tickB2' })
//         client.close() // close after B events
//       })
//     )

//     const bEvents = await fetchSSEEvents(url)
//     expect(bEvents).toEqual(['tickB1', 'tickB2'])

//     // Final check: no mixing of A into B
//     expect(bEvents).not.toContain('tickA1')
//     expect(bEvents).not.toContain('tickA2')
//   })
// })
// import { setupServer } from 'msw/node'
// import { sse } from 'msw'
// import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'

// const server = setupServer()

// beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
// afterAll(() => server.close())
// afterEach(() => server.resetHandlers())

// describe('SSE cleanup stress test (rapid events, multiple handlers)', () => {
//   const url = 'http://test.msw/stream'

//   async function fetchSSEEvents(url: string) {
//     const res = await fetch(url, { headers: { Accept: 'text/event-stream' } })
//     if (!res.body) throw new Error('No response body')

//     const reader = res.body.getReader()
//     const decoder = new TextDecoder()
//     const events: string[] = []

//     while (true) {
//       const { value, done } = await reader.read()
//       if (done) break
//       if (value) {
//         const decoded = decoder.decode(value)
//         const dataLines = decoded
//           .split(/\r?\n/)
//           .filter(l => l.startsWith('data:'))
//           .map(l => l.slice('data:'.length).trim())
//         events.push(...dataLines)
//       }
//     }

//     return events
//   }

//   test('SSE stops emitting events after handler closure under rapid events', async () => {
//     // --- Handler A: emits 100 "A" events rapidly then closes ---
//     server.use(
//       sse(url, ({ client }) => {
//         for (let i = 1; i <= 100; i++) {
//           client.send({ event: 'message', data: `A${i}` })
//         }
//         client.close()
//       })
//     )

//     const aEvents = await fetchSSEEvents(url)
//     expect(aEvents.length).toBe(100)
//     expect(aEvents[0]).toBe('A1')
//     expect(aEvents[99]).toBe('A100')

//     // --- Replace handler with B: emits 50 "B" events rapidly then closes ---
//     server.resetHandlers(
//       sse(url, ({ client }) => {
//         for (let i = 1; i <= 50; i++) {
//           client.send({ event: 'message', data: `B${i}` })
//         }
//         client.close()
//       })
//     )

//     const bEvents = await fetchSSEEvents(url)
//     expect(bEvents.length).toBe(50)
//     expect(bEvents[0]).toBe('B1')
//     expect(bEvents[49]).toBe('B50')

//     // Final check: no A events leaked into B
//     expect(bEvents.some(e => e.startsWith('A'))).toBe(false)
//   }, 10000)
// })

// sse-zombie.test.ts
import { setupServer } from 'msw/node'
import { sse } from 'msw'
import fetch from 'node-fetch'

const server = setupServer(
  sse('/stream', ({ client, request }) => {
    // Send pings every 100ms
    const pingTimer = setInterval(() => client.send({ event: 'ping', data: 'tick' }), 100)

    const cleanup = () => clearInterval(pingTimer)

    // Listen for abort
    request.signal.addEventListener('abort', cleanup)
    client.onabort = cleanup

    return cleanup
  })
)

beforeAll(() => server.listen())
afterAll(() => server.close())
afterEach(() => server.resetHandlers())
test('SSE should stop sending events after client termination', async () => {
  const receivedA: string[] = []

  // Client A
  const controllerA = new AbortController()
  const responseA = await fetch('http://localhost/stream', { signal: controllerA.signal })
  const readerA = responseA.body!.getReader()
  
  // Read first message
  const readChunkA = async () => {
    const { done, value } = await readerA.read()
    if (!done && value) {
      const str = new TextDecoder().decode(value)
      receivedA.push(str.trim())
    }
  }

  await readChunkA()
  // Terminate client A
  controllerA.abort()

  // Client B
  const receivedB: string[] = []
  const responseB = await fetch('http://localhost/stream')
  const readerB = responseB.body!.getReader()

  const readChunkB = async () => {
    const { done, value } = await readerB.read()
    if (!done && value) {
      const str = new TextDecoder().decode(value)
      receivedB.push(str.trim())
    }
  }

  await readChunkB()
  await new Promise(r => setTimeout(r, 200)) // wait to see if old events leak

  console.log('Client A messages:', receivedA)
  console.log('Client B messages:', receivedB)

  // Assert no zombie messages from A appear in B
  const aInB = receivedB.some(msg => msg.includes('tick'))
  expect(aInB).toBe(false)
})
