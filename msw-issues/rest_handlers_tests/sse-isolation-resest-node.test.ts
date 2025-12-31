import { setupServer } from 'msw/node';
import { sse } from 'msw';
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// --- IMPORT ONLY THE PUBLIC API FROM MSW-SSE-TOOLS ---
import {
  createSseClientTracker,
  TrackedMswSseClient,
  SseClientTracker,
} from '../../../src/core/utils/msw-sse-tools'

// --- Refactored MSW SSE Handler Factory ---
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

    const handleCleanup = (reason: string) => {
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
      } catch (err: any) {
        tracker.emitClose('data-send-failed');
      }
    }, 100);

    await tracker.keepAlivePromise;

    if (messageInterval) {
      clearInterval(messageInterval);
    }
  };

  return {
    mswSseHandler,
    getActiveHandlerPromises: () => Array.from(connectionTracker.values()),
  };
};

// polyfill
try {
  if (typeof (globalThis as any).EventSource === 'undefined') {
    const EventSourcePkg = require('eventsource');
    (globalThis as any).EventSource = EventSourcePkg;
    console.info('[setup-sse] EventSource polyfilled with "eventsource" package.');
  }
} catch (error) {
  console.error('Failed to load eventsource polyfill for Node.js:', error);
  throw error;
}

// helpers
function until<T>(predicate: () => T | undefined | null, timeout = 2000, interval = 10) {
  return new Promise<T>((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const loop = () => {
      const val = predicate();
      if (val !== undefined && val !== null) {
        resolve(val);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('timeout waiting for condition'));
        return;
      }
      setTimeout(loop, interval);
    };
    loop();
  });
}

const STREAM_URL = 'http://localhost/stream';
const MESSAGE_RECEIVE_TIMEOUT = 1000;

describe(`msw-sse-tools: Public API cleanup behavior`, () => {
  let server: ReturnType<typeof setupServer>;
  const receivedMessages: Record<string, { msg: string; t: number }[]> = {};
  
  let handlerFactory: TestMswSseHandlerReturn;
  let activeEventSources: EventSource[] = [];

  beforeAll(() => {
    server = setupServer();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    Object.keys(receivedMessages).forEach(key => delete receivedMessages[key]);
    server.resetHandlers();
    activeEventSources = [];
    
    handlerFactory = createTestMswSseHandlerFactory();
    server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);
  });

  afterEach(() => {
    activeEventSources.forEach(es => {
      if (es.readyState !== EventSource.CLOSED) {
        es.close();
      }
    });
  });

  test('single client disconnects gracefully after explicit close', async () => {
    const clientLabel = 'Client1';
    receivedMessages[clientLabel] = [];

    const es = new EventSource(STREAM_URL);
    activeEventSources.push(es);

    es.addEventListener('message', (e: any) => {
      receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
    });

    await until(() => receivedMessages[clientLabel].length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);

    await until(() => handlerFactory.getActiveHandlerPromises().length === 1 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'Should track 1 active handler promise.'
    ).toBe(1);

    es.close();

    const promisesToAwait = handlerFactory.getActiveHandlerPromises();
    await Promise.allSettled(promisesToAwait);

    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'No active handler promises after client disconnects.'
    ).toBe(0);
  }, 15000);

  test('multiple clients disconnect gracefully under stress', async () => {
    const NUM_CLIENTS = 10;

    for (let i = 0; i < NUM_CLIENTS; i++) {
      const clientLabel = `Client${i}`;
      receivedMessages[clientLabel] = [];
      const es = new EventSource(STREAM_URL);
      activeEventSources.push(es);

      es.addEventListener('message', (e: any) => {
        receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
      });
      await new Promise((r) => setTimeout(r, 20));
    }

    await Promise.all(
      Array.from({ length: NUM_CLIENTS }).map((_, i) =>
        until(() => receivedMessages[`Client${i}`].length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT * 2)
      )
    );

    await until(() => handlerFactory.getActiveHandlerPromises().length === NUM_CLIENTS ? true : null, MESSAGE_RECEIVE_TIMEOUT);
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      `Should track ${NUM_CLIENTS} active handler promises.`
    ).toBe(NUM_CLIENTS);

    activeEventSources.forEach(es => es.close());

    const promisesToAwait = handlerFactory.getActiveHandlerPromises();
    await Promise.allSettled(promisesToAwait);

    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'All handlers should be cleaned up.'
    ).toBe(0);
  }, 30000);

  test('new handler instance is isolated after MSW reset', async () => {
    const clientLabel1 = 'InitialClient';
    receivedMessages[clientLabel1] = [];

    const es1 = new EventSource(STREAM_URL);
    activeEventSources.push(es1);
    es1.addEventListener('message', (e: any) => receivedMessages[clientLabel1].push({ msg: String(e.data), t: Date.now() }));

    await until(() => receivedMessages[clientLabel1].length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
    await until(() => handlerFactory.getActiveHandlerPromises().length === 1 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
    
    es1.close();
    await Promise.allSettled(handlerFactory.getActiveHandlerPromises());
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'Initial client cleaned up.'
    ).toBe(0);

    server.resetHandlers();
    handlerFactory = createTestMswSseHandlerFactory();
    server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

    const clientLabel2 = 'NewClient';
    receivedMessages[clientLabel2] = [];
    const es2 = new EventSource(STREAM_URL);
    activeEventSources.push(es2);
    es2.addEventListener('message', (e: any) => receivedMessages[clientLabel2].push({ msg: String(e.data), t: Date.now() }));

    await until(() => receivedMessages[clientLabel2].length > 0 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
    await until(() => handlerFactory.getActiveHandlerPromises().length === 1 ? true : null, MESSAGE_RECEIVE_TIMEOUT);
    
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'New handler factory tracks new client correctly.'
    ).toBe(1);

    es2.close();
    await Promise.allSettled(handlerFactory.getActiveHandlerPromises());
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'New client cleaned up.'
    ).toBe(0);
  }, 25000);

  test('ping mechanism keeps session alive beyond lease timeout', async () => {
    const SHORT_LEASE_TIMEOUT_MS = 600;
    handlerFactory = createTestMswSseHandlerFactory({ leaseTimeoutMs: SHORT_LEASE_TIMEOUT_MS });
    server.use(sse(STREAM_URL, handlerFactory.mswSseHandler) as any);

    const clientLabel = 'ShortLeaseClient';
    receivedMessages[clientLabel] = [];

    const es = new EventSource(STREAM_URL);
    activeEventSources.push(es);
    es.addEventListener('message', (e: any) => {
      receivedMessages[clientLabel].push({ msg: String(e.data), t: Date.now() });
    });

    await until(() => receivedMessages[clientLabel].length > 0, MESSAGE_RECEIVE_TIMEOUT);
    await until(() => handlerFactory.getActiveHandlerPromises().length === 1, MESSAGE_RECEIVE_TIMEOUT);
    
    await new Promise(r => setTimeout(r, SHORT_LEASE_TIMEOUT_MS + 400));

    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'Handler should remain active due to pings refreshing the lease.'
    ).toBe(1);

    expect(
      es.readyState,
      'EventSource should still be OPEN.'
    ).toBe(EventSource.OPEN);

    es.close();
    await Promise.allSettled(handlerFactory.getActiveHandlerPromises());
    expect(
      handlerFactory.getActiveHandlerPromises().length,
      'Handler cleaned up after explicit close.'
    ).toBe(0);
  }, 10000);
});
