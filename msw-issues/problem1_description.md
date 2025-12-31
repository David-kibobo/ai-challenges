Problem Title
MSW SSE Handler Connection Leakage

Implement two utilities in src/core/utils/msw-sse-tools.ts:

    1. createSseClientTracker(client, request, leaseTimeoutMs?, correlationKey?)
        -Returns an object exposing connectionId, keepAlivePromise, onClose(fn), emitClose(reason), and sendApplicationData(message).
        Each tracker maintains an inactivity lease (default: 5000ms).
        Calling sendApplicationData(message) sends an SSE message and resets the inactivity lease upon success.
        The tracker must emit periodic SSE ping events at an interval ≤ half the lease duration.
        Ping events must not reset the inactivity lease.
        Any failed send (ping or application data) must close the connection.
        A correlationKey must exist (derived from inputs or explicitly provided), and must uniquely group trackers.
        keepAlivePromise resolves when the connection closes for any reason.

    2. resetClientLeaseOnActivity(correlationKey) Resets the lease for all trackers sharing that correlationKey.
Base commit: 013304188497e55dda84659a4cad6ef947322d6a