import { ForegroundServicePlugin } from './foregroundServicePlugin';

export interface BackgroundService {
  startRoomForegroundMode(roomCode: string): Promise<void>;
  stopRoomForegroundMode(): Promise<void>;
}

class ForegroundBackgroundService implements BackgroundService {
  async startRoomForegroundMode(roomCode: string) {
    await ForegroundServicePlugin.start({ roomCode });
  }

  async stopRoomForegroundMode() {
    await ForegroundServicePlugin.stop();
  }
}

export const backgroundService: BackgroundService = new ForegroundBackgroundService();
