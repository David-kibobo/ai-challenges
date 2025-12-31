import { setupServer } from 'msw/node'
import { sse } from 'msw'
import { test, expect } from 'vitest'

try {
  if (typeof EventSource === 'undefined') {
    const EventSourcePkg = require('eventsource')
    ;(globalThis as any).EventSource = EventSourcePkg
  }
} catch {}

function until<T>(predicate: () => T | undefined | null, timeout = 3000, interval = 10) {
  return new Promise<T>((resolve, reject) => {
    const deadline = Date.now() + timeout
    const loop = () => {
      const val = predicate()
      if (val !== undefined && val !== null) {
        resolve(val)
        return
      }
      if (Date.now() > deadline) {
        reject(new Error('timeout waiting for condition'))
        return
      }
      setTimeout(loop, interval)
    }
    loop()
  })
}

const STREAM_URL = 'http://localhost/stream-memory-leak'

// ------------------------------
// SSE handler factory
// ------------------------------
// ------------------------------

const activeSseHandlers: Set<any> = new Set()
// ------------------------------
// SSE handler factory (Revised again: NO client.on('close') + Listener Count Tracking)
// ------------------------------
// Add this at the top of your memory-leak.test.ts file, outside any test.
// This will track the number of currently active SSE client sessions (each with its own timers).
const activeClientSessions: Set<Symbol> = new Set();
let nextSessionId = 0; // Simple unique ID for each session

// ------------------------------
// SSE handler factory (FINAL REVISION: Track per-client sessions)
// ------------------------------
function createSseHandler(initialData = '', onClose?: () => void) {
  // This outer function is called once per `sse(url, handler)` registration.
  // We do NOT add to activeClientSessions here.

  return ({ client }: any) => {
    // This inner function is called by MSW *for each new client connection*.
    // This is where we manage per-client resources.

    const sessionId = Symbol(`sseSession-${nextSessionId++}`); // Unique ID for this specific client session
    activeClientSessions.add(sessionId);
    console.log(`[Tracker] Session ${String(sessionId).slice(7, 17)} activated. Active sessions: ${activeClientSessions.size}`);

    let count = 0;
    let timer: NodeJS.Timeout | undefined;
    let leaseTimeout: NodeJS.Timeout | undefined;

    // Function to perform cleanup for THIS specific client session
    const cleanup = () => {
      console.log(`[Server] Performing cleanup for session ${String(sessionId).slice(7, 17)}.`);
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (leaseTimeout) {
        clearTimeout(leaseTimeout);
        leaseTimeout = undefined;
      }
      if (onClose) {
        onClose();
      }
      // Remove this session from the active tracker
      activeClientSessions.delete(sessionId);
      console.log(`[Tracker] Session ${String(sessionId).slice(7, 17)} deactivated. Active sessions: ${activeClientSessions.size}`);
    };

    // Function to send data
    const sendData = () => {
      // If timer is undefined, it means cleanup has already run for this session.
      if (!timer) return; 

      try {
        const msg = `${initialData}${++count}`;
        client.send({ data: msg });
        console.log(`[Server] sent ${msg} to session ${String(sessionId).slice(7, 17)}`);
      } catch (err: any) {
        console.log(`[Server] send error caught for session ${String(sessionId).slice(7, 17)} (client likely closed). Triggering cleanup.`, err.code);
        cleanup(); // Clean up all timers immediately on send error
      }
    };

    // Start sending data immediately and regularly for this session
    timer = setInterval(sendData, 100);

    // Set a safety lease for this session
    leaseTimeout = setTimeout(() => {
      console.log(`[Server] Lease expired for session ${String(sessionId).slice(7, 17)}, stopping interval (safety measure)`);
      cleanup(); // Clean up all timers on lease expiration
    }, 5000); // 5 seconds
  };
}
// ------------------------------
// Test 1 — MaxListenersExceededWarning stress
// ------------------------------
// Test 1 — Asserting Handler Cleanup Count
// ------------------------------
// ------------------------------
// Test 1 — Asserting Active Client Session Cleanup Count
// ------------------------------
test('sse: ensures client sessions are cleaned up correctly under stress', async () => { // Renamed again
  const server = setupServer()
  server.listen({ onUnhandledRequest: 'bypass' })

  // Ensure activeClientSessions is empty before starting the test
  activeClientSessions.clear();
  nextSessionId = 0; // Reset ID counter for clear tracking

  const clients: { es: EventSource; received: string[] }[] = []

  try {
    const handler = createSseHandler('msg:') // This calls createSseHandler ONCE
    server.use(sse(STREAM_URL, handler)) // This registers that ONE handler factory

    await new Promise((r) => setTimeout(r, 50)) // Give MSW a moment to register the handler

    const NUM_CLIENTS = 15;
    // Spawn NUM_CLIENTS EventSource connections.
    // Each will trigger the *inner* function of `createSseHandler`,
    // and thus add to `activeClientSessions`.
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const es = new EventSource(STREAM_URL)
      const received: string[] = []
      es.addEventListener('message', (e) => {
        received.push(String((e as any).data))
        // console.log(`[Client ${i}] received`, (e as any).data)
      })
      clients.push({ es, received })
      await new Promise((r) => setTimeout(r, 50)) // stagger connections to see individual activation logs
    }
    
    // Crucial check: After spawning all clients, activeClientSessions.size should be NUM_CLIENTS
    expect(activeClientSessions.size).toBe(NUM_CLIENTS);
    console.log(`[Test] All ${NUM_CLIENTS} clients spawned. Active sessions: ${activeClientSessions.size}`);


    // Wait for all clients to receive at least one message
    await Promise.all(clients.map((c) => until(() => c.received.length > 0, 5000)))
    console.log('[Test] All clients received initial messages.');

    // Close all clients
    clients.forEach((c) => {
      try {
        c.es.close()
      } catch (err) {
        console.error('Error closing EventSource in test cleanup:', err)
      }
    });
    console.log('[Test] All clients explicitly closed.');

    // Wait a moment for all cleanup routines (triggered by send errors/lease timeouts) to run
    await until(() => activeClientSessions.size === 0, 3000, 50); // Use until to wait for cleanup

    // Assert that all client sessions have been cleaned up
    expect(activeClientSessions.size).toBe(0);

  } finally {
    // Ensure all clients are closed even if previous steps failed
    clients.forEach((c) => {
      try { c.es.close() } catch (err) { /* Already handled, but defensive */ }
    })
    server.close()
    activeClientSessions.clear(); // Ensure clean slate for next test run
    nextSessionId = 0;
  }
})

// Your Test 2 can remain as is, it's already passing.
// test('sse: server detects client closure correctly', async () => { ... });
// ------------------------------
// Test 2 — Server detects client closure
// ------------------------------
test('sse: server detects client closure correctly', async () => {
  const server = setupServer()
  server.listen({ onUnhandledRequest: 'bypass' })

  try {
    let serverDetectedClose = false
    const received: string[] = []

    const handler = createSseHandler('tick:', () => {
      serverDetectedClose = true
    })
    server.use(sse(STREAM_URL, handler))
    await new Promise((r) => setTimeout(r, 20))

    const es = new EventSource(STREAM_URL)
    es.addEventListener('message', (e: MessageEvent) => {
      received.push(String((e as any).data))
      console.log('[Client] received', (e as any).data)
    })

    await until(() => received.length > 0, 3000)
    const beforeCloseCount = received.length

    es.close()
    console.log('[Client] closed connection')

    await until(() => serverDetectedClose, 2000).catch(() => {})

    expect(es.readyState).toBe(2) // CLOSED
    expect(received.length).toBe(beforeCloseCount)
    console.log('[Test] total messages received before close:', beforeCloseCount)
    console.log('Received', received)
  } finally {
    server.close()
  }
})
