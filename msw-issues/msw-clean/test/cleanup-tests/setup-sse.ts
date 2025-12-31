// test/setup-sse.ts

import { EventSource } from 'eventsource'
import { fetch, Headers, Request, Response } from 'undici'

  ; (globalThis as any).EventSource = EventSource;
; (global as any).EventSource = EventSource;

if (typeof globalThis.fetch === 'undefined') {
  ; (globalThis as any).fetch = fetch as any
    ; (globalThis as any).Headers = Headers
    ; (globalThis as any).Request = Request
    ; (globalThis as any).Response = Response
}

console.log('[setup-sse] EventSource polyfilled with "eventsource" package.') 