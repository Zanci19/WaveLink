import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

type VoiceLifecycleHandlers = {
  onResume?: () => void | Promise<void>;
};

class VoiceLifecycleService {
  private handlers: VoiceLifecycleHandlers = {};
  private started = false;
  private cleanupFns: Array<() => void> = [];

  setHandlers(handlers: VoiceLifecycleHandlers) {
    this.handlers = handlers;
  }

  async start() {
    if (this.started) {
      return;
    }
    this.started = true;

    const onResume = () => {
      void this.handlers.onResume?.();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        onResume();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    this.cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));

    window.addEventListener('focus', onResume);
    this.cleanupFns.push(() => window.removeEventListener('focus', onResume));

    if (Capacitor.isNativePlatform()) {
      const listener = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          onResume();
        }
      });
      this.cleanupFns.push(() => listener.remove());
    }
  }

  stop() {
    this.cleanupFns.forEach((cleanup) => cleanup());
    this.cleanupFns = [];
    this.started = false;
    this.handlers = {};
  }
}

export const voiceLifecycleService = new VoiceLifecycleService();
