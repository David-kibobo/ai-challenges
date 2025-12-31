// import { vi, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
// import http from 'node:http'
// import https from 'node:https'


// import { ClientRequestInterceptor } from '../../../../src/interceptors/ClientRequest'

// const HeadersStub = typeof Headers === 'undefined' ? class MockHeaders { } : Headers;


// class MockResponse {
//   public status: number;
//   public statusText: string = 'OK';
//   public headers: any;
//   public ok: boolean;
//   public redirected: boolean = false;
//   public body: null = null;
//   public type: string = 'default';

//   constructor(status: number) {
//     this.status = status;
//     this.ok = status >= 200 && status < 300;
//     this.headers = new HeadersStub();
//   }

//   json() { return Promise.resolve({}); }
//   text() { return Promise.resolve(''); }
//   arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); }
//   clone() { return new MockResponse(this.status); }
// }


// const interceptor = new ClientRequestInterceptor()
// let originalTlsReject: string | undefined

// interface SocketAddresses {
//   localAddress: string | undefined;
//   remoteAddress: string | undefined;
//   family: string | undefined;
// }


// // --- Setup/Teardown ---

// beforeAll(async () => {
//   originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED
//   process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
//   interceptor.apply()
// })

// afterEach(() => {
//   (interceptor as any).removeAllListeners()
// })

// afterAll(async () => {
//   interceptor.dispose()

//   if (originalTlsReject !== undefined) {
//     process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject
//   } else {
//     delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
//   }
// })


// async function testSocketAddresses(
//   protocol: typeof http | typeof https,
//   protocolName: string,
//   useConstructor: boolean = false
// ) {
//   let capturedAddresses: SocketAddresses | undefined;
//   let unhandledCrash: Error | undefined;
//   const TEST_URL = `${protocolName}://localhost/socket-test`

//   let resolveSocketPromise: (socket: any) => void;
//   const socketPromise = new Promise<any>((resolve) => {
//     resolveSocketPromise = resolve;
//   });


//   await new Promise<void>((resolve, reject) => {

//     interceptor.once('request', async ({ controller }) => {
//       const socketRef = await socketPromise;

//       try {
//         const mockResponse = new MockResponse(200);
//         controller.respondWith(mockResponse as any);

//         if (socketRef) {
//           const addressInfo = socketRef.address();

//           capturedAddresses = {
//             localAddress: socketRef.localAddress,
//             remoteAddress: socketRef.remoteAddress,
//             family: addressInfo.family,
//           };
//         }
//       } catch (error) {
//         unhandledCrash = error as Error;
//       }

//       resolve();
//     });

//     const req = useConstructor && protocol.ClientRequest
//       ? new protocol.ClientRequest(TEST_URL)
//       : protocol.request(TEST_URL);

//     req.on('socket', (socket: any) => {
//       resolveSocketPromise(socket);
//     });

//     req.on('error', (err: any) => {
//       if (err.code !== 'ECONNREFUSED') reject(err);
//     });

//     req.end();
//   });

//   // --- Assertions ---
//   expect(unhandledCrash).toBeUndefined();
//   expect(capturedAddresses).toBeDefined();

//   const localAddress = capturedAddresses!.localAddress;
//   const remoteAddress = capturedAddresses!.remoteAddress;
//   const family = capturedAddresses!.family;


//   expect(localAddress).toBeDefined();
//   expect(remoteAddress).toBeDefined();
//   expect(family).toBeDefined();

//   expect(remoteAddress).toEqual(localAddress);
//   expect(localAddress).toMatch(/^127\.0\.0\.1$|^::1$/);

//   if (localAddress!.includes(':')) {
//     expect(family).toEqual('IPv6');
//   } else {
//     expect(family).toEqual('IPv4');
//   }
// }



// async function testUninterceptedRequest(protocol: typeof http | typeof https) {

//   const UNHANDLED_URL = 'http://127.0.0.2:1337/check'

//   return new Promise<void>((resolve) => {

//     (interceptor as any).once('unhandledRequest', ({ request }: any) => {

//       if (request.url.includes('127.0.0.2')) {
//         resolve();
//       }
//     });

//     const req = protocol.request(UNHANDLED_URL);


//     req.on('error', () => {
//       resolve();
//     });

//     req.on('response', () => resolve());

//     req.end();
//   });
// }


// it('should ensure local and remote socket addresses are initialized after HTTP interception', async () => {
//   await testSocketAddresses(http, 'http');
// });

// it('should ensure local and remote socket addresses are initialized after HTTPS interception', async () => {
//   await testSocketAddresses(https, 'https');
// });


// it('should isolate mock state after an unintercepted HTTP request', async () => {
//   await testUninterceptedRequest(http);
//   await testSocketAddresses(http, 'http');
// });

// it('should ensure properties are initialized when using the direct ClientRequest constructor', async () => {
//   await testSocketAddresses(http, 'http', true);
// });

// modules/http/requestError.test.ts

// FIX: Use standard CJS require to ensure we share the exact same module instance
// that the interceptor patches.
const http = require('node:http')
const { once } = require('node:events')
const { URL } = require('node:url')

// === CRITICAL CHANGE: IMPORT INTERCEPTOR FROM SOURCE DIRECTLY ===
// Using the exact path provided by the user
import { ClientRequestInterceptor } from '../../../../src/interceptors/ClientRequest'
// Import necessary types from the compiled package or source if available (assuming they are still needed)
import type { HttpRequest, UnhandledException } from 'mswjs/interceptors' 

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
const createUnavailablePort = vi.fn(async () => 9876) 
const clearEvents = vi.fn() 

// === CRITICAL FIX: INITIALIZE ClientRequestInterceptor DIRECTLY ===
// This ensures that the constructor and setup logic for patching ClientRequest runs immediately.
const interceptor = new ClientRequestInterceptor() 
interceptor.apply()
// =======================================================

let unavailablePort: number
let mockServer: any 
const mockServerPort = 8080 

beforeAll(async () => {
  // 1. (Interceptor already applied above)
  
  // 2. Setup ports and servers
  unavailablePort = await createUnavailablePort() 
  
  mockServer = http.createServer((req: any, res: any) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('Mock Server OK')
  })
  
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

    let nativeRequestError: any
    try {
      await once(req, 'error')
    } catch (error) {
      nativeRequestError = error
    }
    
    // Give time for the async error handler in the interceptor to fire
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

    await once(req, 'error').catch(() => {}) 
    
    // Give time for the async error handler in the interceptor to fire
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe('POST') 
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

    const workingUrl = new URL(`http://127.0.0.1:${mockServerPort}/api/buggy`)
    const req = http.request(workingUrl)
    req.end()
    
    // Give time for the request to be handled and throw the internal exception
    await new Promise(resolve => setTimeout(resolve, 50)) 

    expect(internalErrorFired).toBe(true) 
    expect(requestErrorFired).toBe(false)
  })
})