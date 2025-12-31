// // src/core/utils/internal/sseConnectionTracker.ts
// import { ServerSentEventClient } from '~/core/sse' 
// import { invariant } from 'outvariant'

// export type UntypedSseClient = ServerSentEventClient<{ message: unknown }> & {
//   controller: ReadableStreamDefaultController<unknown> 
// }

// interface ClientConnectionState {
//   isClosed: boolean
//   onCloseCallbacks: Set<() => void>
// }

// const allActiveSseClients = new Set<UntypedSseClient>()
// const clientConnectionStates = new WeakMap<UntypedSseClient, ClientConnectionState>()
// let sseClientCounter = 0;
// const clientDebugIds = new WeakMap<UntypedSseClient, number>(); 


// // MODIFIED: Function now returns the debugId
// export function augmentSseClientWithConnectionTracking(client: UntypedSseClient): number {
//   const debugId = ++sseClientCounter; 
//   clientDebugIds.set(client, debugId);
//   console.log(`[TRACKER-DEBUG] augmentSseClientWithConnectionTracking: New client debug ID: ${debugId}. Current allActiveSseClients size BEFORE: ${allActiveSseClients.size}`);
  
//   allActiveSseClients.add(client);
//   console.log(`[TRACKER-DEBUG] augmentSseClientWithConnectionTracking: Client debug ID: ${debugId} added to allActiveSseClients. Current size AFTER: ${allActiveSseClients.size}`);

//   if (!clientConnectionStates.has(client)) {
//     clientConnectionStates.set(client, { isClosed: false, onCloseCallbacks: new Set() });
//   }

//   const originalClientSend = client.send
//   Object.defineProperty(client, 'send', {
//     value: (payload: any) => {
//       if (getClientIsClosed(client)) {
//         console.warn(`[MSW SSE Tracker] Attempted to send on closed client debug ID: ${clientDebugIds.get(client)}. Payload:`, payload);
//         throw new Error(`[MSW SSE Tracker] Cannot send message: client debug ID ${clientDebugIds.get(client)} connection is already closed.`);
//       }
//       console.debug(`[MSW SSE Tracker] Sending message for client debug ID: ${clientDebugIds.get(client)}. Payload:`, payload);
//       originalClientSend.call(client, payload)
//     },
//     configurable: true
//   })

//   return debugId; // RETURN THE DEBUG ID
// }

// export function onSseClientClose(client: UntypedSseClient, callback: () => void): void {
//   const state = clientConnectionStates.get(client)
//   invariant(state, 'Failed to register "onSseClientClose" callback: client state not found.')

//   if (state.isClosed) {
//     console.debug(`[MSW SSE Tracker] Client debug ID: ${clientDebugIds.get(client)} is already closed, executing callback immediately.`)
//     callback()
//   } else {
//     state.onCloseCallbacks.add(callback)
//   }
// }

// export function emitClientClose(client: UntypedSseClient, reason: string): void {
//   const state = clientConnectionStates.get(client)
//   const debugId = clientDebugIds.get(client); 

//   console.debug(`[TRACKER-DEBUG] emitClientClose called for client debug ID: ${debugId}. Reason: ${reason}`) 

//   if (!state || state.isClosed) {
//     console.debug(`[TRACKER-DEBUG] emitClientClose: Client debug ID: ${debugId} already closed or not found in state map, or already processed.`)
//     return
//   }

//   state.isClosed = true
//   console.debug(`[MSW SSE Tracker] Internal client closure triggered: ${reason}. Marked as isClosed for client debug ID: ${debugId}`); 

//   state.onCloseCallbacks.forEach(cb => {
//     try {
//       cb()
//     } catch (error) {
//       console.error(`[MSW SSE Tracker] Error executing onCloseCallback for client debug ID: ${debugId}:`, error);
//     }
//   })
//   state.onCloseCallbacks.clear()

//   console.log(`[TRACKER-DEBUG] emitClientClose: Calling delete for client debug ID: ${debugId} from allActiveSseClients. Current size BEFORE: ${allActiveSseClients.size}`);
//   const wasDeleted = allActiveSseClients.delete(client)
//   console.log(`[TRACKER-DEBUG] emitClientClose: Client debug ID: ${debugId} deleted from allActiveSseClients? ${wasDeleted}. Current size AFTER: ${allActiveSseClients.size}`);
// }

// export function getClientIsClosed(client: UntypedSseClient): boolean {
//   return clientConnectionStates.get(client)?.isClosed ?? true
// }

// export function __getAllActiveSseClientsForTests(): Set<UntypedSseClient> {
//   return new Set(allActiveSseClients)
// }

// export function __clearAllActiveSseClientsForTests(): void {
//   allActiveSseClients.clear()
//   sseClientCounter = 0; 
// }

// export function closeAllTrackedSseClients(): void {
//   const clientsToClose = Array.from(allActiveSseClients);
//   console.log(`[TRACKER-DEBUG] closeAllTrackedSseClients: Attempting to close ${clientsToClose.length} active clients.`);
//   for (const client of clientsToClose) {
//     emitClientClose(client, 'explicit-closeAllTrackedSseClients-call');
//   }
//   console.log(`[TRACKER-DEBUG] closeAllTrackedSseClients: All clients processed. Remaining active clients: ${allActiveSseClients.size}.`);
// }

// // src/core/utils/msw-sse-tools.ts

// import { invariant } from 'outvariant';
// import { devUtils } from './internal/devUtils';

// // --- Types defined by the test setup (External Contract) ---

// export interface TrackedMswSseClient {
//     id: string;
//     send: (message: { event?: string; data: string | null; id?: string; retry?: number }) => void;
// }

// export interface SseClientTracker {
//     connectionId: number;
//     keepAlivePromise: Promise<void>;
//     onClose(callback: (reason: string) => void): void;
//     emitClose(reason: string): void;
// }

// // --- Internal State Management ---

// interface InternalClientState {
//     connectionId: number;
//     isClosed: boolean;
//     onCloseCallbacks: Set<(reason: string) => void>;
//     resolveKeepAlive?: () => void;
//     pingIntervalId: NodeJS.Timeout | null;
//     lastSuccessfulSend: number; 
//     keepAlivePromise: Promise<void>;
// }

// const clientStates = new WeakMap<TrackedMswSseClient, InternalClientState>();
// let nextConnectionId = 1;
// const allActiveSseClients = new Set<TrackedMswSseClient>();

// const DEFAULT_LEASE_TIMEOUT_MS = 5000;

// const clientToSyntheticIdMap = new WeakMap<TrackedMswSseClient, string>();
// let nextSyntheticId = 1;


// /**
//  * Internal function to trigger all closure mechanisms for a specific client.
//  * This function is the single exit point for all tracked resources.
//  */
// function _internal_emitClientClose(client: TrackedMswSseClient, reason: string): void {
//     const state = clientStates.get(client);

//     if (!state || state.isClosed) {
//         return;
//     }

//     state.isClosed = true;
//     allActiveSseClients.delete(client);

//     if (state.pingIntervalId) {
//         clearInterval(state.pingIntervalId);
//         state.pingIntervalId = null;
//     }

//     state.onCloseCallbacks.forEach(cb => {
//         try {
//             cb(reason);
//         } catch (error) {
//             devUtils.error('Error executing onCloseCallback for client %d: %o', state.connectionId, error);
//         }
//     });
//     state.onCloseCallbacks.clear();

//     if (state.resolveKeepAlive) {
//         state.resolveKeepAlive();
//         state.resolveKeepAlive = undefined;
//     }
// }


// /**
//  * Initializes tracking for an SSE client within an MSW `sse` handler.
//  * @param mswClient The client object used for sending messages.
//  * @param mswRequest The associated request object (used for abort signal).
//  * @param leaseTimeoutMs Maximum period of inactivity before forced closure.
//  */
// export function createSseClientTracker(
//     mswClient: TrackedMswSseClient,
//     mswRequest: Request,
//     leaseTimeoutMs: number = DEFAULT_LEASE_TIMEOUT_MS
// ): SseClientTracker {
//     invariant(!clientStates.has(mswClient), `createSseClientTracker: Client already tracked. Connection ID: ${clientStates.get(mswClient)?.connectionId}`);

//     let clientId = mswClient.id;

//     if (typeof clientId !== 'string' || clientId === '') {
//         if (clientToSyntheticIdMap.has(mswClient)) {
//             clientId = clientToSyntheticIdMap.get(mswClient)!;
//         } else {
//             clientId = `synthetic-${nextSyntheticId++}`;
//             clientToSyntheticIdMap.set(mswClient, clientId);
//         }

//         Object.defineProperty(mswClient, 'id', {
//             value: clientId,
//             configurable: true,
//         });
//     }

//     const connectionId = nextConnectionId++;

//     let resolveKeepAlive: (() => void) | undefined;
//     const keepAlivePromise = new Promise<void>((resolve) => {
//         resolveKeepAlive = resolve;
//     });

//     const state: InternalClientState = {
//         connectionId,
//         isClosed: false,
//         onCloseCallbacks: new Set(),
//         resolveKeepAlive: resolveKeepAlive,
//         pingIntervalId: null,
//         lastSuccessfulSend: Date.now(),
//         keepAlivePromise,
//     };
//     clientStates.set(mswClient, state);
//     allActiveSseClients.add(mswClient);

//     mswRequest.signal.addEventListener('abort', () => {
//         _internal_emitClientClose(mswClient, 'request-aborted');
//     });

//     const originalSend = mswClient.send;

//     Object.defineProperty(mswClient, 'send', {
//         value: (payload: any) => {
//             if (state.isClosed) {
//                 devUtils.warn('Client %d: Attempted to send on a closed connection.', connectionId);
//                 throw new Error(`[SSE-TRACKER] Cannot send message: client ${connectionId} connection is already closed.`);
//             }

//             originalSend.call(mswClient, payload);

//             if (!payload || payload.event !== 'ping') {
//                 state.lastSuccessfulSend = Date.now();
//             }
//         },
//         configurable: true
//     });


//     const effectivePingInterval = Math.min(1000, leaseTimeoutMs / 2);

//     const pingInterval = setInterval(() => {
//         if (state.isClosed) {
//             clearInterval(pingInterval);
//             state.pingIntervalId = null;
//             return;
//         }

//         try {
//             mswClient.send({ event: 'ping', data: `ping-${connectionId}-${Date.now()}` });

//             // The lease timeout must only be reset by non-ping data or client activity,
//             // otherwise the inactivity timeout will never be reached.
//         } catch (error) {
//             _internal_emitClientClose(mswClient, 'ping-send-failed');
//             return;
//         }

//         if (Date.now() - state.lastSuccessfulSend > leaseTimeoutMs) {
//             devUtils.warn('Client %d lease timeout. No activity for %dms. Triggering cleanup.', connectionId, leaseTimeoutMs);
//             _internal_emitClientClose(mswClient, 'lease-timeout');
//         }
//     }, effectivePingInterval);

//     state.pingIntervalId = pingInterval;

//     return {
//         connectionId: state.connectionId,
//         keepAlivePromise,
//         onClose(callback: (reason: string) => void) {
//             if (state.isClosed) {
//                 callback('client-already-closed-on-registration');
//                 return;
//             }
//             state.onCloseCallbacks.add(callback);
//         },
//         emitClose(reason: string) {
//             _internal_emitClientClose(mswClient, reason);
//         },
//     };
// }


// // --- Test/Utility Exports ---

// export function _internal_getAllActiveSseClientsForTests(): Set<TrackedMswSseClient> {
//     return new Set(allActiveSseClients);
// }

// /**
//  * Clears all internal state related to SSE client tracking.
//  * This is crucial for ensuring a clean slate between test runs.
//  */
// export function _internal_clearAllActiveSseClientsForTests(): Promise<void> {
//     devUtils.warn('_internal_clearAllActiveSseClientsForTests: Clearing all internal state for test environment.');

//     const closurePromises: Promise<void>[] = [];

//     for (const client of Array.from(allActiveSseClients)) {
//         const state = clientStates.get(client);
//         if (state && !state.isClosed) {
//             closurePromises.push(state.keepAlivePromise);
//             _internal_emitClientClose(client, 'test-cleanup-force-clear');
//         }
//     }

//     return Promise.all(closurePromises)
//         .then(() => {
//             allActiveSseClients.clear();
//             nextConnectionId = 1;
//             nextSyntheticId = 1;
//         })
//         .catch((error) => {
//             devUtils.error('Error during test cleanup: %o', error);
//             allActiveSseClients.clear();
//             nextConnectionId = 1;
//             nextSyntheticId = 1;
//             throw error;
//         });
// }

// /**
//  * Forces the closure of all currently tracked SSE clients.
//  */
// export function _internal_closeAllTrackedSseClients(reason: string = 'test-forced-cleanup-global'): void {
//     for (const client of Array.from(allActiveSseClients)) {
//         _internal_emitClientClose(client, reason);
//     }
// }

