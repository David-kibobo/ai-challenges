

import { invariant } from 'outvariant';
import { devUtils } from './internal/devUtils';

// --- External Contract Types ---

export interface TrackedMswSseClient {
    id: string;
    send: (message: { event?: string; data: string | null; id?: string; retry?: number }) => void;
}

export interface SseClientTracker {
    connectionId: number;
    keepAlivePromise: Promise<void>;
    onClose(callback: (reason: string) => void): void;
    emitClose(reason: string): void;
    /**
     * Sends application-specific SSE data. This is the method that
     * signals activity to the tracker and resets the inactivity lease timer
     * only on successful send.
     */
    sendApplicationData(message: { event?: string; data: string | null; id?: string; retry?: number }): void;
}

// --- Internal State Management ---

interface InternalClientState {
    connectionId: number;
    isClosed: boolean;
    onCloseCallbacks: Set<(reason: string) => void>;
    resolveKeepAlive?: () => void;
    pingIntervalId: NodeJS.Timeout | null;
    leaseTimeoutId: NodeJS.Timeout | null;
    leaseTimeoutMs: number;
    keepAlivePromise: Promise<void>;
}

class SseClientManager {
    private clientStates = new WeakMap<TrackedMswSseClient, InternalClientState>();
    private allActiveSseClients = new Set<TrackedMswSseClient>();
    private clientToSyntheticIdMap = new WeakMap<TrackedMswSseClient, string>();
    private nextConnectionId = 1;
    private nextSyntheticId = 1;

    public getNextConnectionId(): number {
        return this.nextConnectionId++;
    }

    public getNextSyntheticId(): number {
        return this.nextSyntheticId++;
    }

    public has(client: TrackedMswSseClient): boolean {
        return this.clientStates.has(client);
    }

    public get(client: TrackedMswSseClient): InternalClientState | undefined {
        return this.clientStates.get(client);
    }

    public set(client: TrackedMswSseClient, state: InternalClientState): void {
        this.clientStates.set(client, state);
        this.allActiveSseClients.add(client);
    }

    public getSyntheticId(client: TrackedMswSseClient): string | undefined {
        return this.clientToSyntheticIdMap.get(client);
    }

    public setSyntheticId(client: TrackedMswSseClient, id: string): void {
        this.clientToSyntheticIdMap.set(client, id);
    }

    public getActiveClients(): Set<TrackedMswSseClient> {
        return this.allActiveSseClients;
    }

    public deleteClient(client: TrackedMswSseClient): void {
        this.allActiveSseClients.delete(client);
        this.clientStates.delete(client);
    }

    public clearAllState(): void {
        this.allActiveSseClients.clear();
        this.nextConnectionId = 1;
        this.nextSyntheticId = 1;
    }
}

const manager = new SseClientManager();
const DEFAULT_LEASE_TIMEOUT_MS = 5000;

/**
 * Resets the inactivity lease for all active tracked clients whose stored
 * correlation key equals the provided correlationKey.
 */
export function resetClientLeaseOnActivity(correlationKey: string): void {
    let hit = false;
    for (const client of Array.from(manager.getActiveClients())) {
        try {
            const storedKey = (client as any).requestUrlKey;
            if (storedKey === correlationKey) {
                const state = manager.get(client);
                if (state && !state.isClosed) {
                    setLeaseTimeout(client, state);
                    hit = true;
                }
            }
        } catch (err) {
            devUtils.error('[SSE-TRACKER] Error resetting lease for key %s: %o', correlationKey, err);
        }
    }
    if (hit) {
        devUtils.warn('[SSE-TRACKER] Lease reset triggered by external activity for %s', correlationKey);
    }
}

/**
 * Sets a new one-time timer for lease expiration, clearing any existing one.
 */
function setLeaseTimeout(client: TrackedMswSseClient, state: InternalClientState): void {
    if (state.leaseTimeoutId) {
        clearTimeout(state.leaseTimeoutId);
        state.leaseTimeoutId = null;
    }

    state.leaseTimeoutId = setTimeout(() => {
        devUtils.warn('Client %d lease timeout. Triggering cleanup.', state.connectionId);
        _internal_emitClientClose(client, 'lease-timeout');
    }, state.leaseTimeoutMs);
}

/**
 * Internal function to trigger all closure mechanisms for a specific client.
 */
function _internal_emitClientClose(client: TrackedMswSseClient, reason: string): void {
    const state = manager.get(client);

    if (!state || state.isClosed) {
        return;
    }

    state.isClosed = true;
    manager.deleteClient(client);

    if (state.pingIntervalId) {
        clearInterval(state.pingIntervalId);
        state.pingIntervalId = null;
    }

    if (state.leaseTimeoutId) {
        clearTimeout(state.leaseTimeoutId);
        state.leaseTimeoutId = null;
    }

    // Cleanup the external correlation key stored on client
    try {
        const requestUrlKey = (client as any).requestUrlKey;
        if (requestUrlKey) {
            delete (client as any).requestUrlKey;
        }
    } catch (e) {
        // ignore
    }

    state.onCloseCallbacks.forEach(cb => {
        try {
            cb(reason);
        } catch (error) {
            devUtils.error('Error executing onCloseCallback for client %d: %o', state.connectionId, error);
        }
    });
    state.onCloseCallbacks.clear();

    if (state.resolveKeepAlive) {
        state.resolveKeepAlive();
        state.resolveKeepAlive = undefined;
    }
}

// --- Implementation of createSseClientTracker ---

/**
 * Initializes tracking for an SSE client within an MSW `sse` handler.
 * @param mswClient The client object used for sending messages.
 * @param mswRequest The associated request object (used for abort signal & correlation key).
 * @param leaseTimeoutMs Maximum period of inactivity before forced closure (default 5000ms).
 */
export function createSseClientTracker(
    mswClient: TrackedMswSseClient,
    mswRequest: Request,
    leaseTimeoutMs: number = DEFAULT_LEASE_TIMEOUT_MS
): SseClientTracker {
    invariant(!manager.has(mswClient), `createSseClientTracker: Client already tracked. Connection ID: ${manager.get(mswClient)?.connectionId}`);

    let clientId = mswClient.id;
    if (typeof clientId !== 'string' || clientId === '') {
        if (manager.getSyntheticId(mswClient)) {
            clientId = manager.getSyntheticId(mswClient)!;
        } else {
            clientId = `synthetic-${manager.getNextSyntheticId()}`;
            manager.setSyntheticId(mswClient, clientId);
        }
        // Use Object.defineProperty to ensure the 'id' property is visible/writable
        // in environments that create clients with varying property descriptors.
        Object.defineProperty(mswClient, 'id', {
            value: clientId,
            configurable: true,
        });
    }

    const connectionId = manager.getNextConnectionId();

    let resolveKeepAlive: (() => void) | undefined;
    const keepAlivePromise = new Promise<void>((resolve) => {
        resolveKeepAlive = resolve;
    });

    const state: InternalClientState = {
        connectionId,
        isClosed: false,
        onCloseCallbacks: new Set(),
        resolveKeepAlive: resolveKeepAlive,
        pingIntervalId: null,
        leaseTimeoutId: null,
        leaseTimeoutMs: leaseTimeoutMs,
        keepAlivePromise,
    };
    manager.set(mswClient, state);

    // Store the request URL key (correlation key) on the client for reset hooks.
    const requestUrlKey = mswRequest.url;
    (mswClient as any).requestUrlKey = requestUrlKey;

    // Setup abort detection
    try {
        mswRequest.signal.addEventListener('abort', () => {
            _internal_emitClientClose(mswClient, 'request-aborted');
        });
    } catch (e) {
        // In some environments request.signal may not be available; ignore safely.
    }

    // Start the initial lease timer immediately upon connection
    setLeaseTimeout(mswClient, state);

    // Ping interval: enforce integer and <= leaseTimeoutMs / 2.
    const maxPingInterval = Math.floor(leaseTimeoutMs / 2);
    // Subtract 1ms from the max allowed interval to guarantee the second ping 
    // fires before the lease timeout, fixing the race condition in mocked timers.
    const effectivePingInterval = Math.max(1, maxPingInterval - 1);

    // Use setInterval for stable cadence (avoids recursive setTimeout drift)
    const pingInterval = setInterval(() => {
        if (state.isClosed) {
            clearInterval(pingInterval);
            return;
        }

        try {
            // Send ping using the current `mswClient.send` so tests that replace
            // client.send will observe these calls.
            (mswClient.send as unknown as Function).call(mswClient, {
                event: 'ping',
                data: `ping-${connectionId}-${Date.now()}`
            });
        } catch (error) {
            // transport-level send failure must close connection
            _internal_emitClientClose(mswClient, 'transport-send-failed');
            return;
        }
    }, effectivePingInterval);

    state.pingIntervalId = pingInterval as unknown as NodeJS.Timeout;

    return {
        connectionId: state.connectionId,
        keepAlivePromise,
        onClose(callback: (reason: string) => void) {
            if (state.isClosed) {
                callback('client-already-closed-on-registration');
                return;
            }
            state.onCloseCallbacks.add(callback);
        },
        emitClose(reason: string) {
            _internal_emitClientClose(mswClient, reason);
        },
        sendApplicationData(message: any) {
            if (state.isClosed) {
                throw new Error(`[SSE-TRACKER] Cannot send message: client ${connectionId} is closed.`);
            }

            // Try sending first. Only on successful send do we reset the lease.
            try {
                /**
                 * Justification for the transport error detection pattern:
                 * The underlying ServerSentEventClient class is not exported and cannot be extended.
                 * This pattern (using `try...catch` around `mswClient.send`) is the only reliable way to detect 
                 * a **transport-level send failure** within the MSW handler environment 
                 * (i.e., when `mswClient.send` throws an error). 
                 * Detecting this failure is essential for meeting the core requirement of 
                 * **immediate resource cleanup** on transport errors, preventing resource leaks 
                 * when the client side disconnects unexpectedly without an 'abort' signal.
                 */
                (mswClient.send as unknown as Function).call(mswClient, message);
            } catch (err) {
                // transport error => close immediately
                _internal_emitClientClose(mswClient, 'transport-send-failed');
                throw err;
            }

            // Reset lease because this was application-level activity and send succeeded.
            setLeaseTimeout(mswClient, state);
        }
    };
}


// --- Test/Utility Exports ---

export function _internal_getAllActiveSseClientsForTests(): Set<TrackedMswSseClient> {
    return manager.getActiveClients();
}

/**
 * Clears all internal state related to SSE client tracking.
 * This is crucial for ensuring a clean slate between test runs.
 */
export function _internal_clearAllActiveSseClientsForTests(): Promise<void> {
    devUtils.warn('_internal_clearAllActiveSseClientsForTests: Clearing all internal state for test environment.');

    const closurePromises: Promise<void>[] = [];

    for (const client of Array.from(manager.getActiveClients())) {
        const state = manager.get(client);
        if (state && !state.isClosed) {
            closurePromises.push(state.keepAlivePromise);
            _internal_emitClientClose(client, 'test-cleanup-force-clear');
        }
    }

    return Promise.all(closurePromises)
        .then(() => {
            manager.clearAllState();
        })
        .catch((error) => {
            devUtils.error('Error during test cleanup: %o', error);
            manager.clearAllState();
            throw error;
        });
}

/**
 * Forces the closure of all currently tracked SSE clients.
 */
export function _internal_closeAllTrackedSseClients(reason: string = 'test-forced-cleanup-global'): void {
    for (const client of Array.from(manager.getActiveClients())) {
        _internal_emitClientClose(client, reason);
    }
}