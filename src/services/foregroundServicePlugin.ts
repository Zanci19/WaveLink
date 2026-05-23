import { registerPlugin } from '@capacitor/core';

export interface ForegroundServicePluginType {
  start(options: { roomCode: string }): Promise<void>;
  stop(): Promise<void>;
}

export const ForegroundServicePlugin = registerPlugin<ForegroundServicePluginType>('ForegroundService', {
  web: () => import('./foregroundServiceWeb').then((m) => new m.ForegroundServiceWeb()),
});
