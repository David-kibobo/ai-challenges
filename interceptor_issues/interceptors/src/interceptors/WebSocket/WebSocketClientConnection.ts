import type { WebSocketData, WebSocketTransport } from './WebSocketTransport'
import type { WebSocketEventListener } from './WebSocketOverride'
import { bindEvent } from './utils/bindEvent'
import { CancelableMessageEvent, CloseEvent } from './utils/events'
import { createRequestId } from '../../createRequestId'

const kEmitter = Symbol('kEmitter')
const kBoundListener = Symbol('kBoundListener')

export interface WebSocketClientEventMap {
  message: CancelableMessageEvent<WebSocketData>
  close: CloseEvent
  error: Event
}

export abstract class WebSocketClientConnectionProtocol {
  abstract id: string
  abstract url: URL
  public abstract send(data: WebSocketData): void
  public abstract close(code?: number, reason?: string): void
  public abstract errorWith(reason: string | Error): void

  public abstract addEventListener<
    EventType extends keyof WebSocketClientEventMap
  >(
    type: EventType,
    listener: WebSocketEventListener<WebSocketClientEventMap[EventType]>,
    options?: AddEventListenerOptions | boolean
  ): void

  public abstract removeEventListener<
    EventType extends keyof WebSocketClientEventMap
  >(
    event: EventType,
    listener: WebSocketEventListener<WebSocketClientEventMap[EventType]>,
    options?: EventListenerOptions | boolean
  ): void
}

/**
 * The WebSocket client instance represents an incoming
 * client connection. The user can control the connection,
 * send and receive events.
 */
export class WebSocketClientConnection
  implements WebSocketClientConnectionProtocol
{
  public readonly id: string
  public readonly url: URL

  private [kEmitter]: EventTarget

  constructor(
    public readonly socket: WebSocket,
    private readonly transport: WebSocketTransport
  ) {
    this.id = createRequestId()
    this.url = new URL(socket.url)
    this[kEmitter] = new EventTarget()

    // Emit outgoing client data ("ws.send()") as "message"
    // events on the "client" connection.
    this.transport.addEventListener('outgoing', (event) => {
      const message = bindEvent(
        this.socket,
        new CancelableMessageEvent('message', {
          data: event.data,
          origin: event.origin,
          cancelable: true,
        })
      )

      this[kEmitter].dispatchEvent(message)

      // This is a bit silly but forward the cancellation state
      // of the "client" message event to the "outgoing" transport event.
      // This way, other agens (like "server" connection) can know
      // whether the client listener has pervented the default.
      if (message.defaultPrevented) {
        event.preventDefault()
      }
    })

    /**
     * Emit the "close" event on the "client" connection
     * whenever the underlying transport is closed.
     * @note "client.close()" does NOT dispatch the "close"
     * event on the WebSocket because it uses non-configurable
     * close status code. Thus, we listen to the transport
     * instead of the WebSocket's "close" event.
     */
    this.transport.addEventListener('close', (event) => {
      this[kEmitter].dispatchEvent(
        bindEvent(this.socket, new CloseEvent('close', event))
      )
    })
  }

  /**
   * Listen for the outgoing events from the connected WebSocket client.
   */
  public addEventListener<EventType extends keyof WebSocketClientEventMap>(
    type: EventType,
    listener: WebSocketEventListener<WebSocketClientEventMap[EventType]>,
    options?: AddEventListenerOptions | boolean
  ): void {
    if (!Reflect.has(listener, kBoundListener)) {
      const boundListener = listener.bind(this.socket)

      // Store the bound listener on the original listener
      // so the exact bound function can be accessed in "removeEventListener()".
      Object.defineProperty(listener, kBoundListener, {
        value: boundListener,
        enumerable: false,
        configurable: false,
      })
    }

    this[kEmitter].addEventListener(
      type,
      Reflect.get(listener, kBoundListener) as EventListener,
      options
    )
  }

  /**
   * Removes the listener for the given event.
   */
  public removeEventListener<EventType extends keyof WebSocketClientEventMap>(
    event: EventType,
    listener: WebSocketEventListener<WebSocketClientEventMap[EventType]>,
    options?: EventListenerOptions | boolean
  ): void {
    this[kEmitter].removeEventListener(
      event,
      Reflect.get(listener, kBoundListener) as EventListener,
      options
    )
  }

  /**
   * Send data to the connected client.
   */
  public send(data: WebSocketData): void {
    this.transport.send(data)
  }

  /**
   * Close the WebSocket connection.
   * @param {number} code A status code (see https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1).
   * @param {string} reason A custom connection close reason.
   */
  public close(code?: number, reason?: string): void {
    this.transport.close(code, reason)
  }

  /**
   * Closes the connection immediately, first dispatching an error event
   * followed by a close event.
   *
   * Events are dispatched directly to the socket because the internal emitter
   * is for observation only and does not propagate to user listeners.
   *
   * @param {string | Error} reason The reason for the error.
   */
  public errorWith(reason: string | Error): void {
    const error: Error = typeof reason === 'string' ? new Error(reason) : reason
    const reasonMessage = error.message

    const closeCode: number =
      typeof reason === 'object' && reason instanceof Error ? 1011 : 1006

    this.socket.dispatchEvent(bindEvent(this.socket, new Event('error')))

    this.socket.dispatchEvent(
      bindEvent(
        this.socket,
        new CloseEvent('close', {
          code: closeCode,
          reason: reasonMessage,
          wasClean: false,
        })
      )
    )

    Object.defineProperty(this.socket, 'readyState', {
      value: this.socket.CLOSED,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(this.socket, 'send', {
      value: () => {
        const sendError = new Error(
          `Failed to execute 'send' on 'WebSocket': The connection is not open. The connection's readyState is ${this.socket.CLOSED}.`
        )
        sendError.name = 'InvalidStateError'
        throw sendError
      },
      writable: true,
      configurable: true,
    })
  }
}
