import { PatchedMockSocket } from './PatchedMockSocket';
import * as RealSocketModule from '@mswjs/interceptors/src/interceptors/Socket/MockSocket';

// IMPORTANT: rewrite the export so MSW uses your socket everywhere
(RealSocketModule as any).MockSocket = PatchedMockSocket;

console.log('[PATCH] MockSocket has been overridden with PatchedMockSocket');
