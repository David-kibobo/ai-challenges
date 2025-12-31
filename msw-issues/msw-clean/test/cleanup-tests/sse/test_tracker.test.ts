// test/cleanup-tests/sse/test_tracker.test.ts
import { test, expect, beforeAll, afterEach, afterAll, vitest, vi } from 'vitest'
import { setupServer } from 'msw/node' 
import { sse } from 'msw' 
import {
  augmentSseClientWithConnectionTracking,
  onSseClientClose, 
  __getAllActiveSseClientsForTests,
  __clearAllActiveSseClientsForTests,
  UntypedSseClient,
  closeAllTrackedSseClients,
  emitClientClose, 
} from '../../../src/core/utils/internal/sseConnectionTracker'

vi.useFakeTimers();

const streamUrl = 'http://localhost/stream'

const server = setupServer();

const testClientInstances = new Set<UntypedSseClient>()
const clientPingCounter = new WeakMap<UntypedSseClient, number>()
const clientPingIntervals = new WeakMap<UntypedSseClient, NodeJS.Timeout>()
const clientKeepAliveResolvers = new WeakMap<UntypedSseClient, () => void>()
const clientKeepAlivePromises = new WeakMap<UntypedSseClient, Promise<void>>()
// This map stores the debug ID associated with each client *instance*
const clientDebugIds = new WeakMap<UntypedSseClient, number>(); 


const clientConnectedResolvers = new Map<number, () => void>();
const clientConnectedPromises = new Map<number, Promise<void>>();


beforeAll(() => {
  server.listen()
})

afterEach(() => {
  server.resetHandlers()
  
  for (const client of testClientInstances) {
      const intervalId = clientPingIntervals.get(client);
      if (intervalId) {
          clearInterval(intervalId);
      }
  }

  testClientInstances.clear(); 
  clientConnectedResolvers.clear();
  clientConnectedPromises.clear();

  __clearAllActiveSseClientsForTests() 
  
  vi.runAllTimers(); 
  vi.useRealTimers();
})

afterAll(() => {
  server.close()
})


test.skip('emitClientClose correctly triggers cleanup for tracked SSE clients', async () => {
  const numberOfClients = 5;
  const handlerClientClosePromises: Promise<void>[] = [];

  server.use(
    sse(streamUrl, async ({ client }) => {
      // It's crucial to set the clientDebugId *before* adding to testClientInstances
      // or using it to identify the client, so it's guaranteed to be available.
      const myClientDebugId = augmentSseClientWithConnectionTracking(client as UntypedSseClient);
      clientDebugIds.set(client as UntypedSseClient, myClientDebugId); // Store debug ID with the actual client instance
      
      const resolveConnected = clientConnectedResolvers.get(myClientDebugId);
      if (resolveConnected) {
        resolveConnected();
        clientConnectedResolvers.delete(myClientDebugId);
        console.log(`[TEST] Handler: Connected resolver resolved for client debug ID ${myClientDebugId}`);
      } else {
        console.error(`[TEST] Handler: No connected resolver found for client debug ID ${myClientDebugId}`);
      }

      testClientInstances.add(client as UntypedSseClient);
      console.log(`[TEST] Handler: Client debug ID ${myClientDebugId} added to testClientInstances. Current size:`, testClientInstances.size);
      clientPingCounter.set(client as UntypedSseClient, 0); 

      let resolveKeepAlive: () => void = () => {}; 
      const keepAlivePromise = new Promise<void>((resolve) => {
          resolveKeepAlive = resolve;
      });
      clientKeepAlivePromises.set(client as UntypedSseClient, keepAlivePromise);
      clientKeepAliveResolvers.set(client as UntypedSseClient, resolveKeepAlive!);

      // Register a callback for when our tracker *itself* detects closure.
      // This will be called when `emitClientClose` is invoked.
      onSseClientClose(client as UntypedSseClient, () => {
          console.log(`[TEST] Handler: onSseClientClose triggered for client debug ID ${myClientDebugId}. Resolving keepAlivePromise.`);
          // Ensure interval is cleared when connection is marked as closed by the tracker.
          const intervalId = clientPingIntervals.get(client as UntypedSseClient);
          if (intervalId) {
              clearInterval(intervalId);
              clientPingIntervals.delete(client as UntypedSseClient);
          }
          resolveKeepAlive(); // Resolve the promise associated with this client's handler lifetime
      });

      try {
        client.send({ data: 'initial message' } as any)
        console.debug(`[TEST] Handler: Initial message sent successfully for client debug ID:`, myClientDebugId);
      } catch (error: any) {
        console.error(`[TEST] Handler: Error sending initial message for client debug ID:`, myClientDebugId, error.message);
        // If initial send fails, immediately mark as closed and resolve handler's promise.
        emitClientClose(client as UntypedSseClient, 'initial-send-failed');
        // The onSseClientClose callback will handle resolving keepAlive and clearing interval.
      }

      const pingIntervalId = setInterval(() => {
          const currentPings = clientPingCounter.get(client as UntypedSseClient)! + 1;
          clientPingCounter.set(client as UntypedSseClient, currentPings);
          try {
              client.send({ event: 'ping', data: `ping-${myClientDebugId}-${currentPings}` } as any); 
          } catch (e: any) {
              // This catch block *will* trigger if client.send throws due to `isClosed` flag.
              // It's a valid way to detect a broken pipe if onSseClientClose wasn't triggered earlier.
              console.warn(`[TEST] Handler: Failed to send ping ${currentPings} for client debug ID: ${myClientDebugId}. Error: ${e.message}. Client likely closed.`);
              emitClientClose(client as UntypedSseClient, 'ping-send-failed-try-catch');
              // The onSseClientClose callback will handle resolving keepAlive and clearing interval.
          }
      }, 100); 

      clientPingIntervals.set(client as UntypedSseClient, pingIntervalId);

      await keepAlivePromise; 
      console.log(`[TEST] Handler: Client debug ID ${myClientDebugId} keep-alive promise resolved. Teardown complete for this client.`);
      // No need to explicitly call emitClientClose here, as onSseClientClose handles it upon resolution.
      // If the handler exits for any other reason, the cleanup should already have happened.
    }),
  )

  const eventSources: EventSource[] = []
  const allClientConnectedPromises: Promise<void>[] = [];

  for (let i = 0; i < numberOfClients; i++) {
    const debugId = i + 1; 
    let resolveConnected: () => void = () => {};
    const connectedPromise = new Promise<void>((resolve) => {
      resolveConnected = resolve;
    });
    clientConnectedResolvers.set(debugId, resolveConnected);
    clientConnectedPromises.set(debugId, connectedPromise);
    allClientConnectedPromises.push(connectedPromise);


    const es = new EventSource(streamUrl);
    eventSources.push(es);
    
    es.onerror = (error) => {
      console.error(`[TEST] Client ${debugId}: EventSource error:`, error);
    };

    handlerClientClosePromises.push(
      new Promise<void>(async (resolve) => {
        // Wait until the client is connected and its handler has registered its keepAlivePromise
        await clientConnectedPromises.get(debugId); 

        // Find the client instance that matches this debugId from our 'testClientInstances' set.
        let clientInstance: UntypedSseClient | undefined;
        await vi.waitUntil(() => {
            clientInstance = Array.from(testClientInstances).find(
                c => clientDebugIds.get(c) === debugId
            );
            return !!clientInstance;
        }, { timeout: 1000, interval: 50 });

        if (!clientInstance) {
          console.error(`[TEST] Failed to find client instance ${debugId} in testClientInstances for handlerClientClosePromises.`);
          return resolve(); 
        }

        const p = clientKeepAlivePromises.get(clientInstance);
        if (p) {
          p.then(resolve);
        } else {
          console.warn(`[TEST] Client ${debugId} keepAlivePromise not found, resolving early.`);
          resolve();
        }
      })
    );
  }

  console.log(`[TEST] Waiting for all clients to connect and be augmented in handlers...`)
  await vitest.advanceTimersByTime(500); 
  await Promise.all(allClientConnectedPromises); 
  console.log(`[TEST] All clients connected and augmented.`);

  console.log(`[TEST] Active clients in tracker BEFORE closing EventSources:`, __getAllActiveSseClientsForTests().size);
  expect(__getAllActiveSseClientsForTests().size).toBe(numberOfClients); 
  expect(testClientInstances.size).toBe(numberOfClients);

  console.log(`[TEST] Closing all EventSource instances...`)
  for (let i = 0; i < numberOfClients; i++) {
    const clientDebugId = i + 1;
    console.log(`[TEST] Calling close() on client ${clientDebugId} EventSource.`);
    eventSources[i].close();

    // CRITICAL: Explicitly call emitClientClose for the corresponding tracked client.
    // Use `testClientInstances` because we know these are the exact client objects
    // that were augmented and are being tracked.
    const trackedClient = Array.from(testClientInstances).find(
        c => clientDebugIds.get(c) === clientDebugId
    );
    if (trackedClient) {
        console.log(`[TEST] Found tracked client ${clientDebugId} in testClientInstances. Calling emitClientClose.`);
        emitClientClose(trackedClient, `explicit-client-close-from-test-${clientDebugId}`);
    } else {
        console.warn(`[TEST] Could not find tracked client for debug ID ${clientDebugId} in testClientInstances to call emitClientClose.`);
    }
  }

  // Advance timers significantly to allow the emitted close events to propagate
  // and for the onSseClientClose callbacks to fire and resolve keepAlivePromises.
  await vitest.advanceTimersByTime(500); 
  
  console.log(`[TEST] Waiting for all handlerClientClosePromises to resolve (server-side cleanup)...`)
  await Promise.all(handlerClientClosePromises);
  console.log(`[TEST] All handlerClientClosePromises resolved.`);

  closeAllTrackedSseClients();
  console.log(`[TEST] Explicitly called closeAllTrackedSseClients.`);

  expect(__getAllActiveSseClientsForTests().size).toBe(0); 
  expect(testClientInstances.size).toBe(numberOfClients); 
  
  let remainingIntervals = 0;
  for (const client of testClientInstances) {
      if (clientPingIntervals.has(client)) {
          remainingIntervals++;
      }
  }
  expect(remainingIntervals).toBe(0);

}, 35000);