// // test/cleanup-tests/sse/sse-all-scenarios.browser-like.test.ts
// import { setupServer } from 'msw/node'
// import { sse } from 'msw'
// import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

// const streamUrl = 'http://localhost/stream-browser-like' // Unique URL for browser-like tests

// /**
//  * Helpers
//  */
// function until<T>(predicate: () => T | undefined | null, timeout = 2000, interval = 10) {
//   return new Promise<T>((resolve, reject) => {
//     const deadline = Date.now() + timeout
//     const loop = () => {
//       const val = predicate()
//       if (val !== undefined && val !== null) {
//         resolve(val)
//         return
//       }
//       if (Date.now() > deadline) {
//         reject(new Error('timeout waiting for condition'))
//         return
//       }
//       setTimeout(loop, interval)
//     }
//     loop()
//   })
// }

// // --- GLOBAL STATE ---
// const activeClientSessions = new Set<Symbol>()
// let nextSessionId = 0
// const receivedMessages: { client: Symbol; t: number; message: string }[] = []

// // --- MODIFIED createTrackedSseHandler ---
// function createTrackedSseHandler(prefix: string, emitInterval = 50) { // Removed leaseDuration
//   return ({ client }: any) => {
//     const sessionId = Symbol(`sseSession-${nextSessionId++}`)
//     activeClientSessions.add(sessionId)
//     // console.info(`[Tracker] Session ${sessionId.description} ACTIVATED for ${prefix}. Active: ${activeClientSessions.size}`)

//     let timer: NodeJS.Timeout | null = null; // Still need to track the timer for this session

//     const cleanup = (reason: string) => {
//       if (!activeClientSessions.has(sessionId)) {
//         // Already cleaned up, prevent double cleanup
//         return
//       }
//       if (timer) {
//         clearInterval(timer)
//         timer = null // Clear reference
//       }
//       // activeClientSessions.delete(sessionId)
//       console.info(`[Server] Cleaning up session ${sessionId.description} for ${prefix}. Reason: ${reason}. Active: ${activeClientSessions.size}`)
//     }

//     const sendData = () => {
//       const message = `${prefix}:${Date.now()}`
//       try {
//         client.send({data:message})
//         receivedMessages.push({ client: sessionId, t: Date.now(), message })
//       } catch (error: any) {
//         // client.error()
//         console.warn(`[Server] send error caught for ${prefix} session ${sessionId.description}: ${error.message}`)
//         cleanup(`send error (${error.message})`) // <-- THIS IS THE ONLY AUTOMATIC CLEANUP WE'll rely on
//       }
//     }

//     timer = setInterval(sendData, emitInterval)

   
//   }
// }
// describe('SSE robust cleanup and isolation (browser-like)', () => {
//   let server: ReturnType<typeof setupServer>

//   beforeAll(() => {
//     server = setupServer()
//     server.listen({ onUnhandledRequest: 'bypass' })
//   })

//   afterAll(() => server.close())

//   // Ensure global trackers are reset before EACH test to avoid interference
//   beforeEach(() => {
//     activeClientSessions.clear()
//     nextSessionId = 0
//     // server.resetHandlers() // Ensure server is clean for next test
//   })

//   // --- Test 1: Client disconnect stress test ---
//   test.skip('ensures client sessions are cleaned up correctly under stress', async () => {
//     const NUM_CLIENTS = 15
//     const handler = createTrackedSseHandler('MSG', 100)
//     server.resetHandlers(
//         sse(streamUrl, handler)
//     );
//     await new Promise((r) => setTimeout(r, 500));

//     const clients: EventSource[] = []
//     for (let i = 0; i < NUM_CLIENTS; i++) {
//       const es = new EventSource(streamUrl)
//       clients.push(es)
//       await new Promise((r) => setTimeout(r, 20)) // Stagger connections
//     }

//     await new Promise((r) => setTimeout(r, 500))
//      console.info(`[Test Debug] activeClientSessions.size BEFORE ASSERTION: ${activeClientSessions.size}`)
//     expect(activeClientSessions.size,'All initial client sessions should be active.').toBe(NUM_CLIENTS)
//     console.info(`[Test] All ${NUM_CLIENTS} clients spawned. Active sessions: ${activeClientSessions.size}`)

//     clients.forEach((es, idx) => {
//       try {
//         es.close()
//         console.info(`[Test] Client ${idx} explicitly closed.`)
//       } catch (err) {
//         console.error(`[Test Error] closing EventSource for client ${idx}:`, err)
//       }
//     })
//     console.info('[Test] All clients explicitly closed.')

//     const finalCleanupWait = 5000
//     let waitedTime = 0
//     while (activeClientSessions.size > 0 && waitedTime < finalCleanupWait) {
//       // console.info(`[Test Wait] Waiting for final cleanup. Active sessions: ${activeClientSessions.size} (waited ${waitedTime}ms)`)
//       await new Promise((r) => setTimeout(r, 100))
//       waitedTime += 100
//     }

//     if (activeClientSessions.size > 0) {
//       console.error(`[Test Error] TIMEOUT: ${activeClientSessions.size} sessions still active after ${finalCleanupWait}ms.`)
//       for (const sessionId of activeClientSessions) {
//         console.error(`[Test Error] Uncleaned session ID: ${sessionId.description}`)
//       }
//     }
//     expect(activeClientSessions.size,'All client sessions should be cleaned up after explicit close or lease expiration.').toBe(0)
//   }, 10000)


//   // --- Test 2: Robust isolation and cleanup across handler resets ---
//   test.skip('robust isolation and cleanup across handler resets', async () => {
//     const receivedPerClient: Record<string, { msg: string; t: number }[]> = {}

//     const aHandler = createTrackedSseHandler('A', 30)

//     server.use(sse(streamUrl, aHandler))

//     const clientsA = [1, 2, 3].map((id) => {
//       const label = `A${id}`
//       receivedPerClient[label] = []
//       const es = new EventSource(streamUrl)
//       es.addEventListener('message', (e) => {
//         receivedPerClient[label].push({ msg: String((e as any).data), t: Date.now() })
//       })
//       return { es, label }
//     })

//     const slowLabel = 'A_slow'
//     receivedPerClient[slowLabel] = []
//     const esSlow = new EventSource(streamUrl)
//     esSlow.addEventListener('message', (e) => {
//       const arrival = { msg: String((e as any).data), t: Date.now() }
//       setTimeout(() => { receivedPerClient[slowLabel].push(arrival) }, 90)
//     })

//     await Promise.all(
//       Object.keys(receivedPerClient)
//         .filter((k) => k.startsWith('A'))
//         .map((label) =>
//           until(() => receivedPerClient[label].length > 0, 2000).catch((e) => {
//             throw new Error(`Client ${label} didn't receive any A messages: ${String(e)}`)
//           }),
//         ),
//     )
//     await new Promise((r) => setTimeout(r, 100))

//     expect(activeClientSessions.size,'All initial A clients should be active.').toBe(4)

//     for (let i = 0; i < 20; i++) {
//       const temp = new EventSource(streamUrl)
//       temp.close()
//       await new Promise((r) => setTimeout(r, 5))
//     }
//     await new Promise((r) => setTimeout(r, 500))

//     expect(activeClientSessions.size, 'Temporary connections should have been cleaned up (not adding to active sessions).').toBe(4)

//     const resetTime = Date.now()
//     const bHandler = createTrackedSseHandler('B', 30)
//     server.resetHandlers(sse(streamUrl, bHandler))
//     await new Promise((r) => setTimeout(r, 20))

//     const clientsB = [1, 2].map((id) => {
//       const label = `B${id}`
//       receivedPerClient[label] = []
//       const es = new EventSource(streamUrl)
//       es.addEventListener('message', (e) => {
//         receivedPerClient[label].push({ msg: String((e as any).data), t: Date.now() })
//       })
//       return { es, label }
//     })

//     const aNewLabel = 'A_new'
//     receivedPerClient[aNewLabel] = []
//     const esANew = new EventSource(streamUrl)
//     esANew.addEventListener('message', (e) => {
//       receivedPerClient[aNewLabel].push({ msg: String((e as any).data), t: Date.now() })
//     })

//     await Promise.all(
//       ['B1', 'B2', aNewLabel].map((label) =>
//         until(() => receivedPerClient[label] && receivedPerClient[label].length > 0, 2500).catch((e) => {
//           throw new Error(`Client ${label} didn't receive any post-reset messages: ${String(e)}`)
//         }),
//       ),
//     )

//     await new Promise((r) => setTimeout(r, 500))

//     expect(activeClientSessions.size, 'After reset, only new B/A_new sessions should be active, old A sessions should be gone.').toBe(3)

//     ;[...clientsA.map(c => c.es), esSlow, ...clientsB.map(c => c.es), esANew].forEach((es) => {
//       try { es.close() } catch {}
//     })

//     const finalFinalCleanupWait = 8000
//     let waitedTime = 0
//     while (activeClientSessions.size > 0 && waitedTime < finalFinalCleanupWait) {
//       console.info(`[Test Wait] Waiting for final final cleanup. Active sessions: ${activeClientSessions.size} (waited ${waitedTime}ms)`)
//       await new Promise((r) => setTimeout(r, 100))
//       waitedTime += 100
//     }
//     if (activeClientSessions.size > 0) {
//       console.error(`[Test Error] TIMEOUT: ${activeClientSessions.size} sessions still active after all clients closed (${finalFinalCleanupWait}ms).`)
//     }
//     expect(activeClientSessions.size,'All sessions should be cleaned up after all clients are closed.').toBe(0)

//     Object.keys(receivedPerClient)
//       .filter((k) => k.startsWith('A') && k !== aNewLabel)
//       .forEach((k) => {
//         const msgs = receivedPerClient[k].map(x => x.msg)
//         expect(msgs.length).toBeGreaterThan(0)
//         const bad = msgs.filter(m => !m.startsWith('A:'))
//         expect(bad, `Client ${k} received non-A messages: ${JSON.stringify(bad)}`).toEqual([])
//       })
//     ;['B1', 'B2', aNewLabel].forEach(k => {
//       const msgs = receivedPerClient[k].map(x => x.msg)
//       expect(msgs.length).toBeGreaterThan(0)
//       const bad = msgs.filter(m => !m.startsWith('B:'))
//       expect(bad, `Client ${k} got unexpected non-B messages: ${JSON.stringify(bad)}`).toEqual([])
//     })
//     for (const [label, arr] of Object.entries(receivedPerClient)) {
//       for (const entry of arr) {
//         if (entry.msg.startsWith('A:')) {
//           expect(entry.t <= resetTime,
//             `Detected A message (${entry.msg}) delivered to ${label} at ${entry.t} after reset (${resetTime})`,
//           ).toBe(true)
//         }
//       }
//     }
//     for (const [label, arr] of Object.entries(receivedPerClient)) {
//       for (const entry of arr) {
//         if (entry.msg.startsWith('B:')) {
//           expect(entry.t >= resetTime,
//             `Detected B message (${entry.msg}) delivered to ${label} at ${entry.t} before reset (${resetTime})`,
//           ).toBe(true)
//         }
//       }
//     }
//   }, 20000)
// })

// test/cleanup-tests/sse/sse-all-scenarios.browser-like.test.ts

import { setupServer } from 'msw/node';
import { sse } from 'msw';
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// --- IMPORT ONLY THE PUBLIC API FROM MSW-SSE-TOOLS ---
import {
  createSseClientTracker,
  TrackedMswSseClient,
  SseClientTracker,
} from '../../../src/core/utils/msw-sse-tools';

// --- CONFIG ---
const STREAM_URL = 'http://localhost/stream-browser-like';
const MESSAGE_RECEIVE_TIMEOUT = 1000;

interface TestMswSseHandlerReturn {
  mswSseHandler: ({ client, request }: { client: any, request: Request }) => Promise<void>;
  getActiveHandlerPromises: () => Promise<void>[];
}

const createTestMswSseHandlerFactory = (options?: { leaseTimeoutMs?: number }): TestMswSseHandlerReturn => {
  const connectionTracker = new Map<string, Promise<void>>();

  const mswSseHandler = async ({ client, request }: { client: any, request: Request }) => {
    const trackedClient = client as TrackedMswSseClient;
    const tracker: SseClientTracker = createSseClientTracker(trackedClient, request, options?.leaseTimeoutMs);
    const connectionId = tracker.connectionId;

    let messageInterval: NodeJS.Timeout | null = null;

    connectionTracker.set(trackedClient.id, tracker.keepAlivePromise);

    const handleCleanup = () => {
      if (messageInterval) {
        clearInterval(messageInterval);
        messageInterval = null;
      }
      connectionTracker.delete(trackedClient.id);
    };

    tracker.onClose(handleCleanup);

    messageInterval = setInterval(() => {
      try {
        trackedClient.send({ event: 'message', data: `TEST_MSG:${connectionId}:${Date.now()}` });
      } catch {
        tracker.emitClose('data-send-failed');
      }
    }, 100);

    await tracker.keepAlivePromise;
    if (messageInterval) clearInterval(messageInterval);
  };

  return {
    mswSseHandler,
    getActiveHandlerPromises: () => Array.from(connectionTracker.values()),
  };
};

try {
  if (typeof (globalThis as any).EventSource === 'undefined') {
    const EventSourcePkg = require('eventsource');
    (globalThis as any).EventSource = EventSourcePkg;
  }
} catch (error) {
  console.error('Failed to load eventsource polyfill:', error);
  throw error;
}

function until<T>(predicate: () => T | undefined | null, timeout = 2000, interval = 10) {
  return new Promise<T>((resolve, reject) => {
    const end = Date.now() + timeout;
    const loop = () => {
      const val = predicate();
      if (val !== undefined && val !== null) return resolve(val);
      if (Date.now() > end) return reject(new Error('timeout'));
      setTimeout(loop, interval);
    };
    loop();
  });
}

// --- TEST SUITE ---
describe(`msw-sse-tools: Browser-Like Cleanup & Isolation (Public API)`, () => {
  let server: ReturnType<typeof setupServer>;
  const receivedMessages: Record<string, { msg: string; t: number }[]> = {};
  let handlerFactory: TestMswSseHandlerReturn;
  let activeEventSources: EventSource[] = [];

  beforeAll(() => {
    server = setupServer();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(() => server.close());

  beforeEach(() => {
    Object.keys(receivedMessages).forEach(k => delete receivedMessages[k]);
    activeEventSources = [];
    handlerFactory = createTestMswSseHandlerFactory();
    server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);
  });

  afterEach(() => {
    activeEventSources.forEach(es => {
      if (es.readyState !== EventSource.CLOSED) es.close();
    });
  });

  // --- Scenario 1 ---
  test.skip('single client disconnects gracefully after explicit close', async () => {
    const clientLabel = 'Client1';
    receivedMessages[clientLabel] = [];

    const es = new EventSource(STREAM_URL);
    activeEventSources.push(es);

    es.addEventListener('message', (e: any) =>
      receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() })
    );

    await until(() => receivedMessages[clientLabel].length > 0, MESSAGE_RECEIVE_TIMEOUT);
    await until(() => handlerFactory.getActiveHandlerPromises().length === 1, MESSAGE_RECEIVE_TIMEOUT);

    es.close();

    const promisesToAwait = handlerFactory.getActiveHandlerPromises();
    await Promise.allSettled(promisesToAwait);

    expect(handlerFactory.getActiveHandlerPromises().length, 'No active handler promises after client disconnects')
      .toBe(0);
  }, 15000);

  // --- Scenario 2 ---
  test.skip('multiple clients disconnect gracefully under stress', async () => {
    const NUM = 10;

    for (let i = 0; i < NUM; i++) {
      const id = `Client${i}`;
      receivedMessages[id] = [];
      const es = new EventSource(STREAM_URL);
      activeEventSources.push(es);
      es.addEventListener('message', (e: any) =>
        receivedMessages[id].push({ msg: String(e.data), t: Date.now() })
      );
      await new Promise(r => setTimeout(r, 20));
    }

    await Promise.all(
      Array.from({ length: NUM }).map((_, i) =>
        until(() => receivedMessages[`Client${i}`].length > 0, MESSAGE_RECEIVE_TIMEOUT * 2)
      )
    );

    await until(() => handlerFactory.getActiveHandlerPromises().length === NUM, MESSAGE_RECEIVE_TIMEOUT);

    activeEventSources.forEach(es => es.close());

    const promisesToAwait = handlerFactory.getActiveHandlerPromises();
    await Promise.allSettled(promisesToAwait);

    expect(handlerFactory.getActiveHandlerPromises().length, 'All handlers should be cleaned up')
      .toBe(0);
  }, 30000);

  // --- Scenario 3: Isolation WITHOUT resetHandlers ---
  test.skip('new handler instance is isolated after previous clients disconnect', async () => {
    const clientLabel1 = 'InitialClient';
    receivedMessages[clientLabel1] = [];

    const es1 = new EventSource(STREAM_URL);
    activeEventSources.push(es1);
    es1.addEventListener('message', (e: any) =>
      receivedMessages[clientLabel1].push({ msg: String(e.data), t: Date.now() })
    );

    await until(
      () => (receivedMessages[clientLabel1].length > 0 ? true : null),
      MESSAGE_RECEIVE_TIMEOUT
    );
    await until(
      () => (handlerFactory.getActiveHandlerPromises().length === 1 ? true : null),
      MESSAGE_RECEIVE_TIMEOUT
    );

    es1.close();
    await Promise.allSettled(handlerFactory.getActiveHandlerPromises());
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'Initial client cleaned up.'
    ).toBe(0);

    // Create a fresh handler instance
    handlerFactory = createTestMswSseHandlerFactory();
    server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

    const clientLabel2 = 'NewClient';
    receivedMessages[clientLabel2] = [];
    const es2 = new EventSource(STREAM_URL);
    activeEventSources.push(es2);

    es2.addEventListener('message', (e: any) =>
      receivedMessages[clientLabel2].push({ msg: String(e.data), t: Date.now() })
    );

    await until(
      () => (receivedMessages[clientLabel2].length > 0 ? true : null),
      MESSAGE_RECEIVE_TIMEOUT
    );
    await until(
      () => (handlerFactory.getActiveHandlerPromises().length === 1 ? true : null),
      MESSAGE_RECEIVE_TIMEOUT
    );

    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'New handler tracks new connection correctly.'
    ).toBe(1);

    es2.close();
    await Promise.allSettled(handlerFactory.getActiveHandlerPromises());
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'New handler cleaned up.'
    ).toBe(0);
  }, 25000);

  // --- Scenario 4 ---
  test.skip('ping mechanism keeps session alive beyond lease timeout', async () => {
    const SHORT = 600;
    handlerFactory = createTestMswSseHandlerFactory({ leaseTimeoutMs: SHORT });
    server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

    const label = 'ShortLeaseClient';
    receivedMessages[label] = [];

    const es = new EventSource(STREAM_URL);
    activeEventSources.push(es);

    es.addEventListener('message', (e: any) =>
      receivedMessages[label].push({ msg: String(e.data), t: Date.now() })
    );

    await until(() => receivedMessages[label].length > 0, MESSAGE_RECEIVE_TIMEOUT);
    await until(() => handlerFactory.getActiveHandlerPromises().length === 1, MESSAGE_RECEIVE_TIMEOUT);

    await new Promise(r => setTimeout(r, SHORT + 400));

    expect(handlerFactory.getActiveHandlerPromises().length, 'Handler should still be active due to pings')
      .toBe(1);
    expect(es.readyState, 'EventSource should still be open')
      .toBe(EventSource.OPEN);

    es.close();
    await Promise.allSettled(handlerFactory.getActiveHandlerPromises());

    expect(handlerFactory.getActiveHandlerPromises().length, 'Handler cleaned up after explicit close')
      .toBe(0);
  }, 10000);
});
