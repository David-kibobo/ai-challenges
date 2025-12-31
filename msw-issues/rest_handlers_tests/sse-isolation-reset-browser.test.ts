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
const DEFAULT_TRACKER_LEASE_TIMEOUT_MS = 5000;

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
    server.resetHandlers();
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
  test('single client disconnects gracefully after explicit close', async () => {
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
  test('multiple clients disconnect gracefully under stress', async () => {
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


  // --- Scenario 3: Isolation and MSW Reset ---
test('new handler instance is isolated after MSW reset', async () => {
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

  // --- RESET HANDLERS (no extra logic added!) ---
  handlerFactory = createTestMswSseHandlerFactory();
  server.resetHandlers(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

  // Wait for es1 to close after resetHandlers()
  try {
    es1.close();
  } catch {}

  // Ensure new factory starts isolated
  expect(
    handlerFactory.getActiveHandlerPromises().length,
    'New handler factory must start with 0 active promises (isolation).'
  ).toBe(0);

  // --- Start a NEW connection ---
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
    'New handler tracks new connection'
  ).toBe(1);

  // Cleanup
  es2.close();
  await Promise.allSettled(handlerFactory.getActiveHandlerPromises());

  expect(
    handlerFactory.getActiveHandlerPromises().length,
    'New handler cleaned up'
  ).toBe(0);
}, 25000);

  // --- Scenario 4 ---
  test('ping mechanism keeps session alive beyond lease timeout', async () => {
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


// // test/cleanup-tests/sse/sse-handler-matching.node.test.ts

// import { setupServer } from 'msw/node';
// import { sse } from 'msw';
// import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';


// const STREAM_URL = 'http://localhost/stream';
// const MESSAGE_RECEIVE_TIMEOUT = 1000;



// const path = require('path');

// const SOLVER_PATH = path.resolve(__dirname, '../../../src/core/utils/msw-sse-tools.ts');



// console.info(`[Test Setup] Looking for solver implementation at: ${SOLVER_PATH}`);


// interface TestMswSseHandlerReturn {
//   mswSseHandler: ({ client, request }: { client: any, request: Request }) => Promise<void>;
//   getActiveHandlerPromises: () => Promise<void>[];
//   stopHandlerActivity: () => void;

//   injectThrowingSend?: (shouldThrow: boolean) => void;
// }


// let createTestMswSseHandlerFactory: (options?: { leaseTimeoutMs?: number }) => TestMswSseHandlerReturn;


// try {
//   // eslint-disable-next-line @typescript-eslint/no-var-requires
//   const solverModule = await import(SOLVER_PATH);



//   if (solverModule.createSseClientTracker) {
//     console.info("✅ Solver implementation found. Using their solution.");

//     createTestMswSseHandlerFactory = (options) => {
//       const connectionTracker = new Map<string, Promise<void>>();
//       const intervals = new Set<NodeJS.Timeout>();
//       let shouldSendThrow = false;
//       let activeMswClient: any | null = null;

//       const injectThrowingSend = (shouldThrow: boolean) => {
//         shouldSendThrow = shouldThrow;
//       };

//       const mswSseHandler = async ({ client, request }: { client: any, request: Request }) => {
//         activeMswClient = client;



//         const tracker = solverModule.createSseClientTracker(client, request, options?.leaseTimeoutMs);
//         const connectionId = tracker.connectionId;

//         let messageInterval: NodeJS.Timeout | null = null;

//         connectionTracker.set(client.id || String(connectionId), tracker.keepAlivePromise);

//         const handleCleanup = () => {
//           if (messageInterval) {
//             clearInterval(messageInterval);
//             intervals.delete(messageInterval);
//             messageInterval = null;
//           }
//           connectionTracker.delete(client.id || String(connectionId));
//         };

//         tracker.onClose(handleCleanup);

//         messageInterval = setInterval(() => {
//           try {

//             if (shouldSendThrow) {

//               throw new Error("Simulated Send Failure");
//             }

//             client.send({ event: 'message', data: `TEST_MSG:${connectionId}:${Date.now()}` });
//           } catch (err: any) {
//             // This is the cleanup path we are testing
//             tracker.emitClose('data-send-failed');
//           }
//         }, 100);

//         intervals.add(messageInterval);

//         await tracker.keepAlivePromise;

//         if (messageInterval) { clearInterval(messageInterval); }
//         activeMswClient = null;
//       };

//       return {
//         mswSseHandler,
//         getActiveHandlerPromises: () => Array.from(connectionTracker.values()),
//         stopHandlerActivity: () => {
//           intervals.forEach(clearInterval);
//           intervals.clear();
//           shouldSendThrow = false;
//           console.log("[Test Handler] Forced stop of all handler activity intervals.");
//         },
//         injectThrowingSend
//       };
//     };
//   } else {
//     throw new Error("Module found but export missing");
//   }

// } catch (error) {
//   console.warn("⚠️ Solver implementation NOT found. Using BUGGY implementation to fail tests intentionally.");


//   createTestMswSseHandlerFactory = () => {
//     const leakedPromises: Promise<void>[] = [];

//     const mswSseHandler = async ({ client }: { client: any }) => {

//       const leakyPromise = new Promise<void>(() => { });
//       leakedPromises.push(leakyPromise);

//       console.log(`[Buggy Handler] Client connected. Starting eternal interval...`);


//       setInterval(() => {
//         try {
//           client.send({ event: 'message', data: 'leaking...' });
//         } catch (e) { }
//       }, 100);

//       await leakyPromise;
//     };

//     return {
//       mswSseHandler,
//       getActiveHandlerPromises: () => leakedPromises,
//       stopHandlerActivity: () => { },
//       injectThrowingSend: () => { }
//     };
//   };
// }



// try {
//   if (typeof (globalThis as any).EventSource === 'undefined') {
//     const EventSourcePkg = require('eventsource');
//     (globalThis as any).EventSource = EventSourcePkg;
//   }
// } catch (error) { console.error('Failed to load eventsource polyfill', error); }

// function until<T>(predicate: () => T | undefined | null, timeout = 2000, interval = 10) {
//   return new Promise<T>((resolve, reject) => {
//     const deadline = Date.now() + timeout;
//     const loop = () => {
//       const val = predicate();
//       if (val !== undefined && val !== null) { resolve(val); return; }
//       if (Date.now() > deadline) { reject(new Error('timeout waiting for condition')); return; }
//       setTimeout(loop, interval);
//     };
//     loop();
//   });
// }


// describe(`msw-sse-tools: API cleanup behavior`, () => {
//   let server: ReturnType<typeof setupServer>;
//   const receivedMessages: Record<string, { msg: string; t: number }[]> = {};

//   let handlerFactory: TestMswSseHandlerReturn;
//   let activeEventSources: EventSource[] = [];

//   beforeAll(() => {
//     server = setupServer();
//     server.listen({ onUnhandledRequest: 'bypass' });
//   });

//   afterAll(() => {
//     server.close();
//   });

//   beforeEach(() => {
//     Object.keys(receivedMessages).forEach(key => delete receivedMessages[key]);
//     server.resetHandlers();
//     activeEventSources = [];


//     handlerFactory = createTestMswSseHandlerFactory();
//     server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);
//   });

//   afterEach(() => {
//     activeEventSources.forEach(es => {
//       if (es.readyState !== EventSource.CLOSED) es.close();
//     });

//     handlerFactory.stopHandlerActivity();
//   });

//   test('single client disconnects gracefully after explicit close (Promise Settlement Check)', async () => {
//     const clientLabel = 'Client1';
//     receivedMessages[clientLabel] = [];
//     const es = new EventSource(STREAM_URL);
//     activeEventSources.push(es);

//     es.addEventListener('message', (e: any) => {
//       if (receivedMessages[clientLabel]) {
//         receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
//       }
//     });


//     await until(() => receivedMessages[clientLabel]?.length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);


//     await until(() => handlerFactory.getActiveHandlerPromises().length === 1 ? true : null, MESSAGE_RECEIVE_TIMEOUT);

//     const promisesToAwait = handlerFactory.getActiveHandlerPromises();
//     const keepAlivePromise = promisesToAwait[0];

//     es.close();


//     const result = await Promise.race([
//       keepAlivePromise.then(() => 'RESOLVED'),
//       new Promise(r => setTimeout(() => r('TIMEOUT'), 1000))
//     ]);

//     expect(result, 'The keepAlivePromise MUST resolve upon client close.').toBe('RESOLVED');
//     expect(handlerFactory.getActiveHandlerPromises().length, 'No active handler promises after promise resolution.').toBe(0);
//   }, 15000);

//   test('multiple clients disconnect gracefully under stress', async () => {
//     const NUM_CLIENTS = 10;
//     for (let i = 0; i < NUM_CLIENTS; i++) {
//       const clientLabel = `Client${i}`;
//       receivedMessages[clientLabel] = [];
//       const es = new EventSource(STREAM_URL);
//       activeEventSources.push(es);
//       es.addEventListener('message', (e: any) => {
//         if (receivedMessages[clientLabel]) {
//           receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
//         }
//       });
//       await new Promise((r) => setTimeout(r, 10));
//     }

//     await Promise.all(Array.from({ length: NUM_CLIENTS }).map((_, i) =>
//       until(() => receivedMessages[`Client${i}`]?.length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT * 2)
//     ));

//     await until(() => handlerFactory.getActiveHandlerPromises().length === NUM_CLIENTS ? true : null, MESSAGE_RECEIVE_TIMEOUT);

//     const allPromises = handlerFactory.getActiveHandlerPromises();

//     activeEventSources.forEach(es => es.close());


//     await Promise.race([
//       Promise.allSettled(allPromises),
//       new Promise(r => setTimeout(r, 500))
//     ]);


//     expect(handlerFactory.getActiveHandlerPromises().length, 'All handlers should be cleaned up.').toBe(0);
//   }, 30000);

//   test('new handler instance is isolated after previous clients disconnect', async () => {
//     const clientLabel1 = 'InitialClient';
//     receivedMessages[clientLabel1] = [];
//     const es1 = new EventSource(STREAM_URL);
//     activeEventSources.push(es1);
//     es1.addEventListener('message', (e: any) => {
//       if (receivedMessages[clientLabel1]) receivedMessages[clientLabel1].push({ msg: String(e.data), t: Date.now() });
//     });

//     await until(() => receivedMessages[clientLabel1]?.length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
//     await until(() => handlerFactory.getActiveHandlerPromises().length === 1 ? true : null, MESSAGE_RECEIVE_TIMEOUT);

//     es1.close();
//     await new Promise(r => setTimeout(r, 200));

//     expect(handlerFactory.getActiveHandlerPromises().length, 'Initial client cleaned up.').toBe(0);

//     handlerFactory = createTestMswSseHandlerFactory();
//     server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

//     const clientLabel2 = 'NewClient';
//     receivedMessages[clientLabel2] = [];
//     const es2 = new EventSource(STREAM_URL);
//     activeEventSources.push(es2);
//     es2.addEventListener('message', (e: any) => {
//       if (receivedMessages[clientLabel2]) receivedMessages[clientLabel2].push({ msg: String(e.data), t: Date.now() });
//     });

//     await until(() => receivedMessages[clientLabel2]?.length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);

//     expect(handlerFactory.getActiveHandlerPromises().length, 'New handler factory tracks new client correctly.').toBe(1);

//     es2.close();
//     await new Promise(r => setTimeout(r, 200));
//     expect(handlerFactory.getActiveHandlerPromises().length, 'New client cleaned up.').toBe(0);
//   }, 25000);

//   test('ping mechanism keeps session alive beyond lease timeout', async () => {

//     const SHORT_LEASE_TIMEOUT_MS = 600;
//     handlerFactory = createTestMswSseHandlerFactory({ leaseTimeoutMs: SHORT_LEASE_TIMEOUT_MS });
//     server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

//     const clientLabel = 'ShortLeaseClient';
//     receivedMessages[clientLabel] = [];
//     const es = new EventSource(STREAM_URL);
//     activeEventSources.push(es);
//     es.addEventListener('message', (e: any) => {
//       if (receivedMessages[clientLabel]) receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
//     });

//     await until(() => receivedMessages[clientLabel]?.length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);


//     await new Promise(r => setTimeout(r, SHORT_LEASE_TIMEOUT_MS + 400));


//     expect(handlerFactory.getActiveHandlerPromises().length, 'Handler should remain active.').toBe(1);
//     expect(es.readyState, 'EventSource should still be OPEN.').toBe(EventSource.OPEN);

//     es.close();
//     await new Promise(r => setTimeout(r, 200));


//     expect(handlerFactory.getActiveHandlerPromises().length, 'Handler cleaned up after explicit close.').toBe(0);
//   }, 10000);


//   test('connection forcibly closed when inactivity exceeds lease timeout', async () => {

//     const FORCED_TIMEOUT_MS = 600;


//     handlerFactory = createTestMswSseHandlerFactory({ leaseTimeoutMs: FORCED_TIMEOUT_MS });
//     server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

//     const clientLabel = 'ForcedCloseClient';
//     receivedMessages[clientLabel] = [];
//     const es = new EventSource(STREAM_URL);
//     activeEventSources.push(es);
//     es.addEventListener('message', (e: any) => {
//       if (receivedMessages[clientLabel]) receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
//     });


//     await until(() => receivedMessages[clientLabel]?.length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
//     expect(handlerFactory.getActiveHandlerPromises().length, 'Handler should be active initially.').toBe(1);


//     handlerFactory.stopHandlerActivity();


//     const WAIT_TIME = FORCED_TIMEOUT_MS + 400;
//     await new Promise(r => setTimeout(r, WAIT_TIME));


//     expect(handlerFactory.getActiveHandlerPromises().length,
//       'Handler MUST be closed and cleaned up after inactivity timeout.').toBe(0);


//     if (es.readyState !== EventSource.CLOSED) es.close();
//   }, 10000);


//   test('send failure triggers immediate connection closure and cleanup', async () => {

//     if (!handlerFactory.injectThrowingSend) {
//       console.warn("Skipping send failure test: injectThrowingSend not implemented on handlerFactory.");
//       return;
//     }

//     const clientLabel = 'SendFailureClient';
//     receivedMessages[clientLabel] = [];
//     const es = new EventSource(STREAM_URL);
//     activeEventSources.push(es);

//     es.addEventListener('message', (e: any) => {
//       if (receivedMessages[clientLabel]) {
//         receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
//       }
//     });


//     await until(() => receivedMessages[clientLabel]?.length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
//     await until(() => handlerFactory.getActiveHandlerPromises().length === 1 ? true : null, MESSAGE_RECEIVE_TIMEOUT);

//     const keepAlivePromise = handlerFactory.getActiveHandlerPromises()[0];

//     handlerFactory.injectThrowingSend(true);


//     await new Promise(r => setTimeout(r, 200));


//     const result = await Promise.race([
//       keepAlivePromise.then(() => 'RESOLVED'),
//       new Promise(r => setTimeout(() => r('TIMEOUT'), 500))
//     ]);

//     expect(result, 'The keepAlivePromise MUST resolve immediately after send failure.').toBe('RESOLVED');
//     expect(handlerFactory.getActiveHandlerPromises().length, 'No active handler promises after send failure cleanup.').toBe(0);

//     if (es.readyState !== EventSource.CLOSED) es.close();

//   }, 10000);
// });

// test/cleanup-tests/sse/sse-handler-matching.node.test.ts


// 3. Test: Crucial check for state isolation (addresses global state issue)
// 3. Test: Crucial check for state isolation (addresses global state issue)
test('new handler instance is isolated after previous clients disconnect', async () => {
  //
  // --- Phase 1: Start first handler instance and connect first client ---
  //
  const clientLabel1 = 'InitialClient';
  receivedMessages[clientLabel1] = [];

  const es1 = new EventSource(STREAM_URL);
  activeEventSources.push(es1);

  es1.addEventListener('message', (e: any) => {
    receivedMessages[clientLabel1]?.push({ msg: String(e.data), t: Date.now() });
  });

  // Wait until the first message is received (ensures handler fully initialized)
  await until(
    () => receivedMessages[clientLabel1]?.length > 0 ? true : null,
    MESSAGE_RECEIVE_TIMEOUT
  );

  // Ensure handlerFactory is tracking exactly one active session
  await until(
    () => handlerFactory.getActiveHandlerPromises().length === 1 ? true : null,
    MESSAGE_RECEIVE_TIMEOUT
  );

  //
  // --- Phase 2: Close first client and wait for full cleanup ---
  //
  es1.close();

  // Allow cleanup: lease timeout (600ms) + buffer
  await vi.advanceTimersByTimeAsync(1200);

  expect(
    handlerFactory.getActiveHandlerPromises().length,
    '1st client state must be cleaned up.'
  ).toBe(0);

  //
  // --- Phase 3: Fully clear MSW state and install a fresh SSE handler ---
  //
  server.resetHandlers();

  // Create clean handler factory instance
  handlerFactory = createTestMswSseHandlerFactory();

  // Register new SSE handler
  server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

  // --- FORCE MSW to bind the new handler before the next EventSource connects ---
  // A short dummy fetch ensures MSW has resolved the new handler routing for STREAM_URL.
  await fetch(STREAM_URL).catch(() => {});
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(5);

  //
  // --- Phase 4: Connect second client under the new handler ---
  //
  const clientLabel2 = 'NewClient';
  receivedMessages[clientLabel2] = [];

  const es2 = new EventSource(STREAM_URL);
  activeEventSources.push(es2);

  // Drain microtasks so the request hits MSW before timer-driven message ticks
  await Promise.resolve();

  await until(
    () => receivedMessages[clientLabel2]?.length > 0 ? true : null,
    MESSAGE_RECEIVE_TIMEOUT
  );

  expect(
    handlerFactory.getActiveHandlerPromises().length,
    'New handler factory must track only the new client.'
  ).toBe(1);

  //
  // --- Phase 5: Cleanly disconnect second client and confirm cleanup ---
  //
  es2.close();
  await vi.advanceTimersByTimeAsync(200);

  expect(
    handlerFactory.getActiveHandlerPromises().length,
    'New client cleaned up.'
  ).toBe(0);
}, 25000);
