import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest'
import { PatchedMockSocket } from './PatchedMockSocket'

export class PatchedClientRequestInterceptor extends ClientRequestInterceptor {
  protected createSocket(options: any) {
    console.log('[PATCH] createSocket() called (patched)')
    return new PatchedMockSocket(options)
  }
}
