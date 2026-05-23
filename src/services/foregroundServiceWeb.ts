import type { ForegroundServicePluginType } from './foregroundServicePlugin';

export class ForegroundServiceWeb implements ForegroundServicePluginType {
  async start(): Promise<void> {
  }

  async stop(): Promise<void> {
  }
}
