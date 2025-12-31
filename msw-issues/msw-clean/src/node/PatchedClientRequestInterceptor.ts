import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest'
import { PatchedMockSocket } from './PatchedMockSocket'

export function patchClientRequestInterceptor() {
  const proto = ClientRequestInterceptor.prototype as any

  if (!proto.__patched) {
    const originalCreateSocket = proto.createSocket
    proto.createSocket = function (...args: any[]) {
      console.log('[PATCH] createSocket called')
      return new PatchedMockSocket()
    }
    proto.__patched = true
    console.log('[PATCH] ClientRequestInterceptor patched')
  }
}
