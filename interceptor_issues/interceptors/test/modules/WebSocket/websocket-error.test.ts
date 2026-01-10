/**
 * @vitest-environment node-with-websocket
 */
import { describe, test, expect, afterAll, beforeEach, vi, beforeAll } from 'vitest'

const hoistedContext = vi.hoisted(async () => {
  const { WebSocketInterceptor } = await import('../../../src/interceptors/WebSocket/index.js')
  const { default: WebSocket } = await import('ws')

  const interceptor = new WebSocketInterceptor()
  interceptor.apply()

  return {
    interceptor,
    WebSocket: global.WebSocket,
  }
})

let resolvedInterceptor: Awaited<typeof hoistedContext>['interceptor']
let WebSocket: Awaited<typeof hoistedContext>['WebSocket']

import type { WebSocketClientConnection } from '../../../src/interceptors/WebSocket/WebSocketClientConnection.js'

interface NodeError extends Error {
  code?: string;
}

const WS_URL = 'ws://localhost:9000/echo'

beforeAll(async () => {
  const context = await hoistedContext
  resolvedInterceptor = context.interceptor
  WebSocket = context.WebSocket
})

describe('WebSocketInterceptor: client.errorWith(reason)', () => {
  let socket: any
  let mockClient: WebSocketClientConnection

  afterAll(() => {
    resolvedInterceptor.dispose()
  })

  beforeEach(async () => {
    mockClient = null as any
    socket = new WebSocket(WS_URL)

    const interceptorConnected = new Promise<void>((resolve) => {
      resolvedInterceptor.once('connection', ({ client }) => {
        mockClient = client
        resolve()
      })
    })

    const socketOpened = new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.OPEN) {
        resolve()
      } else {
        socket.onopen = () => resolve()
      }
    })

    await Promise.all([interceptorConnected, socketOpened])
  })

  test('Should fire generic "error" then "close" events with reason', async () => {
    const reasonString = 'Simulated connection loss.'
    const eventOrder: string[] = []

    socket.onerror = (e: any) => {
      eventOrder.push('error')

      socket.errorPayload = e
    }
    socket.onclose = (e: any) => {
      eventOrder.push('close')
      socket.closePayload = e
    }

    mockClient.errorWith(reasonString)

    await vi.waitFor(() => {
      expect(eventOrder).toEqual(['error', 'close'])
    })


    expect(socket.errorPayload).toBeInstanceOf(Event)
    expect(socket.errorPayload.message).toBeUndefined()
    expect(socket.errorPayload.error).toBeUndefined()


    expect(socket.closePayload.code).toBe(1006)
    expect(socket.closePayload.reason).toBe(reasonString)
    expect(socket.closePayload.wasClean).toBe(false)

    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  test('Should map Error objects to close code 1011', async () => {
    const networkError = new Error('Policy violation') as NodeError

    const eventOrder: string[] = []
    socket.onerror = () => eventOrder.push('error')
    socket.onclose = (e: any) => {
      eventOrder.push('close')
      socket.closePayload = e
    }

    mockClient.errorWith(networkError)

    await vi.waitFor(() => {
      expect(eventOrder).toEqual(['error', 'close'])
    })


    expect(socket.closePayload.code).toBe(1011)
    expect(socket.closePayload.reason).toBe(networkError.message)
    expect(socket.closePayload.wasClean).toBe(false)

    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  test('Should throw InvalidStateError on subsequent send() calls', async () => {
    mockClient.errorWith('Closing.')

    await vi.waitFor(() => {
      expect(socket.readyState).toBe(WebSocket.CLOSED)
    })

    expect(() => socket.send('data')).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' })
    )
  })
})
