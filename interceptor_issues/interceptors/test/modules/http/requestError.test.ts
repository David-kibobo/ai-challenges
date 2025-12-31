// FIX: Use standard CJS require to ensure we share the exact same module instance
// that the interceptor patches.
const http = require('node:http')
const { once } = require('node:events')
const { URL } = require('node:url')

import { Interceptor, HttpRequest, UnhandledException } from 'mswjs/interceptors'
import { describe, test, beforeAll, afterAll, afterEach, expect, vi } from 'vitest'

// --- Type Definitions ---
interface NodeError extends Error {
    code?: string;
}

type RequestErrorEvent = {
  request: HttpRequest
  cause: NodeError
}
type UnhandledExceptionEvent = UnhandledException 

// --- Setup ---
// Using a high, likely unused port (9876) to reliably get ECONNREFUSED
const createUnavailablePort = vi.fn(async () => 9876) 
const clearEvents = vi.fn() 

// === CRITICAL FIX: APPLY INTERCEPTOR IN GLOBAL SCOPE ===
// The interceptor must be applied here, outside of beforeAll, to ensure 
// it patches 'node:http' before any other module imports it.
const interceptor = new Interceptor({ name: 'test-node-interceptor' }) 
interceptor.apply()
// =======================================================

let unavailablePort: number
let mockServer: any 
const mockServerPort = 8080 

beforeAll(async () => {
  // 1. (Interceptor already applied above)
  
  // 2. Setup ports and servers
  unavailablePort = await createUnavailablePort() 
  
  // Create a server for Test 2.1 to send requests to
  mockServer = http.createServer((req: any, res: any) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('Mock Server OK')
  })
  
  // Wait for the mock server to start listening
  await new Promise<void>(resolve => {
    mockServer.listen(mockServerPort, '127.0.0.1', resolve)
  })
})

afterEach(() => {
  clearEvents()
  vi.clearAllMocks()
})

afterAll(async () => {
  interceptor.dispose()
  // Close the mock server
  await new Promise(resolve => mockServer.close(resolve))
})

// --- Tests ---

describe('ClientRequest Error Event Handling', () => {
  
  test('1.1: Fires "request:error" event on ECONNREFUSED network failure', async () => {
    let errorEventFired = false
    let capturedCause: RequestErrorEvent['cause'] | undefined 

    console.log('Test 1.1: Attaching "request:error" listener...')
    interceptor.on('request:error', ({ cause }: RequestErrorEvent) => {
      console.log('Test 1.1: 🔥 "request:error" event FIRED!')
      console.log('Test 1.1: Cause code:', cause?.code)
      errorEventFired = true
      capturedCause = cause
    })

    const requestUrl = new URL(`http://127.0.0.1:${unavailablePort}/data`)
    const req = http.request(requestUrl)
    req.end()

    // Wait for the native error (expected)
    let nativeRequestError: any
    try {
      await once(req, 'error')
    } catch (error) {
      nativeRequestError = error
    }
    
    // Wait a moment to ensure asynchronous events (like 'request:error') have time to settle
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(errorEventFired).toBe(true)
    expect(capturedCause).toBeInstanceOf(Error)
    expect(capturedCause?.code).toBe('ECONNREFUSED')
  })

  test('1.2: Preserves the correct request context (URL/Method) in the payload', async () => {
    let capturedRequest: HttpRequest | undefined = undefined 

    console.log('Test 1.2: Attaching "request:error" listener...')
    interceptor.on('request:error', ({ request }: RequestErrorEvent) => {
      console.log('Test 1.2: 🔥 "request:error" event FIRED!')
      capturedRequest = request
    })

    const requestUrl = new URL(`http://127.0.0.1:${unavailablePort}/user/123`)
    const req = http.request(requestUrl, { method: 'POST' })
    req.end()

    // We MUST catch the native error event to prevent an unhandled rejection in Node.js
    await once(req, 'error').catch(() => {}) 
    
    // Wait a moment to ensure asynchronous events (like 'request:error') have time to settle
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe('POST') 
    // Check strict string presence to avoid URL object comparison issues
    const urlString = capturedRequest!.url.href || String(capturedRequest!.url)
    expect(urlString).toContain('/user/123')
  })
})

describe('Boundary Separation: Internal vs. Network Errors', () => {
  
  test('2.1: Does NOT fire "request:error" when a mock handler throws an internal exception', async () => {
    const internalException = new Error('Intentional internal error in handler')
    let internalErrorFired = false
    let requestErrorFired = false
    
    console.log('Test 2.1: Attaching "unhandledException" and "request:error" listeners...')
    interceptor.on('unhandledException', (exception: UnhandledExceptionEvent) => {
        console.log('Test 2.1: ✅ "unhandledException" FIRED.')
        internalErrorFired = true
    })

    interceptor.on('request:error', () => {
        console.log('Test 2.1: 🚫 "request:error" FIRED (UNEXPECTED).')
        requestErrorFired = true
    })
    
    // Setup a handler that throws
    interceptor.on('request', ({ request }: { request: HttpRequest }) => {
      if (request.url.includes('/api/buggy')) {
          throw internalException
      }
    })

    // Send the request to the MOCK SERVER (port 8080) so it doesn't immediately fail with ECONNREFUSED
    const workingUrl = new URL(`http://127.0.0.1:${mockServerPort}/api/buggy`)
    const req = http.request(workingUrl)
    req.end()
    
    // The request will be handled by the interceptor, which throws, leading to 'unhandledException'
    await new Promise(resolve => setTimeout(resolve, 50)) 

    // We expect the internal handler to throw, fire 'unhandledException', and NOT fire 'request:error'
    expect(internalErrorFired).toBe(true) 
    expect(requestErrorFired).toBe(false)
  })
})