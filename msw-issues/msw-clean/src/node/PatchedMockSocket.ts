import * as net from 'node:net'

import { normalizeSocketWriteArgs, WriteArgs, WriteCallback } from './utils';

console.log('[PATCH] PatchedMockSocket file loaded');

export class PatchedMockSocket extends net.Socket {
  public connecting = false;
  private options?: any;
  private queuedChunks: Buffer[] = [];

  constructor(options?: any) {
    super();
    this.options = options;

    console.log('[PATCH] PatchedMockSocket constructor()');
    this.connect();
  }

  connect() {
    console.log('[PATCH] connect()');
    this.connecting = true;
    process.nextTick(() => this.emit('connect'));
    return this;
  }

  write(...args: WriteArgs): boolean {
    const [chunk, encoding, callback] = normalizeSocketWriteArgs(args);
    console.log('[PATCH] write():', chunk?.toString());

    if (this.options?.write) this.options.write(chunk, encoding, callback);

    const bufferChunk = Buffer.from(chunk);
    // Queue if no listeners yet
    if (this.listenerCount('data') === 0) {
      this.queuedChunks.push(bufferChunk);
    } else {
      this.emit('data', bufferChunk);
    }

    if (callback) callback(null);
    return true;
  }

  end(...args: WriteArgs): boolean {
    const [chunk] = normalizeSocketWriteArgs(args);
    if (chunk) {
      if (this.options?.write) this.options.write(chunk);
      const bufferChunk = Buffer.from(chunk);

      if (this.listenerCount('data') === 0) {
        this.queuedChunks.push(bufferChunk);
      } else {
        this.emit('data', bufferChunk);
      }
    }

    console.log('[PATCH] end():', chunk?.toString());
    process.nextTick(() => this.emit('end'));
    return true;
  }

  push(chunk: any, encoding?: BufferEncoding): boolean {
    if (this.options?.read) this.options.read(chunk, encoding);

    const bufferChunk = Buffer.from(chunk);
    if (this.listenerCount('data') === 0) {
      this.queuedChunks.push(bufferChunk);
    } else {
      this.emit('data', bufferChunk);
    }

    return super.push(chunk, encoding);
  }

  // Flush queued chunks when listeners attach
  private flushQueued() {
    while (this.queuedChunks.length > 0) {
      const chunk = this.queuedChunks.shift()!;
      this.emit('data', chunk);
    }
  }

  // Override on() to flush queued chunks immediately when a 'data' listener attaches
  override on(event: string | symbol, listener: (...args: any[]) => void) {
    const result = super.on(event, listener);
    if (event === 'data') {
      this.flushQueued();
    }
    return result;
  }
}
