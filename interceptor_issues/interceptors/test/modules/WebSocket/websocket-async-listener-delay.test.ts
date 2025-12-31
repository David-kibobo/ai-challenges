// Canonical Test File: ./test/modules/websocket/test-async-listener-pause.ts

import { test, expect, beforeAll, afterAll, vi } from 'vitest'

// 1. IMPORT NECESSARY MODULES (Assuming the environment can resolve the library)
// The solver's implementation will be available here.
import { WebSocketInterceptor } from 'msw-interceptors/websocket' 
import { WebSocket } from 'ws' // The target environment WebSocket implementation

// --- Environment Helpers ---
const MOCK_SERVER_URL = 'ws://localhost:9999'
const ASYNC_DELAY_MS = 200 

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let interceptor: WebSocketInterceptor

beforeAll(() => {
  // Use fake timers to ensure the 200ms delay is instant and deterministic.
  vi.useFakeTimers()
  
  // Initialize and enable the real library interceptor.
  // This is the point where the library hijacks the global WebSocket constructor.
  interceptor = new WebSocketInterceptor()
  interceptor.enable()
})

afterAll(() => {
  interceptor.disable()
  vi.useRealTimers()
})

// -----------------------------------------------------------------
// THE CORE TEST CASE
// -----------------------------------------------------------------

test('should hold the WebSocket state in CONNECTING until the async connection listener resolves', async () => {
  // 1. Arrange: Register an async listener that simulates a slow connection setup (200ms)
  const connectionListener = vi.fn(async ({ client }) => {
    // This action must block the connection flow if the fix is correct.
    await delay(ASYNC_DELAY_MS) 
  })

  // Register the listener using the library's public API.
  interceptor.on('connection', connectionListener) 

  // 2. Act: Instantiate a new WebSocket.
  // This triggers the library's internal logic which should respect the async listener.
  const client = new new WebSocket(MOCK_SERVER_URL) // Note: The new here should resolve the global mock.

  // 3. CRITICAL ASSERTION (The Proof of the Bug/Fix)
  // If the library is BUGGY (synchronous emission), the state will immediately be OPEN (1), and this assertion FAILS.
  // If the library is FIXED (asynchronous emission), the state will still be CONNECTING (0), and this assertion PASSES.
  expect(client.readyState).toBe(client.CONNECTING) 

  // 4. Cleanup/Finalize: Advance time and confirm the connection eventually opens
  
  // Wait for the "open" event which signals the connection finally transitioned to OPEN.
  const openPromise = new Promise((resolve) => client.addEventListener('open', resolve))
  
  // Advance the fake timer by the required delay amount.
  vi.advanceTimersByTime(ASYNC_DELAY_MS) 
  
  // Wait for the open event to confirm the asynchronous listener has completed.
  await openPromise 

  // Final check: The state must eventually be OPEN (1).
  expect(client.readyState).toBe(client.OPEN)
  
  // Confirm the listener was called exactly once.
  expect(connectionListener).toHaveBeenCalledTimes(1)
  
  client.close()
})