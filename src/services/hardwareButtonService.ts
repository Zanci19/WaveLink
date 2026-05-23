import { Capacitor } from '@capacitor/core';
import { HardwareKey, preferencesService } from './preferences/preferencesService';
import { HardwareKeyPlugin, NativeHardwareKeyEvent } from './hardwareKeyPlugin';

type PushToTalkHandlers = {
  onStart?: () => void;
  onStop?: () => void;
};

class HardwareButtonService {
  private initialized = false;
  private detecting = false;
  private detectResolver: ((key: HardwareKey) => void) | null = null;
  private enabled = false;
  private detectedKey: HardwareKey | null = null;
  private pressedKeys = new Set<string>();
  private handlers: PushToTalkHandlers = {};
  private nativeListenerRemove: (() => void) | null = null;

  async initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    await this.refreshPreferences();
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    if (Capacitor.isNativePlatform()) {
      const listener = await HardwareKeyPlugin.addListener('hardwareKey', (event) => {
        this.handleNativeKey(event);
      });
      this.nativeListenerRemove = () => listener.remove();
    }
  }

  async refreshPreferences() {
    this.enabled = await preferencesService.getHardwarePttEnabled();
    this.detectedKey = await preferencesService.getHardwareKey();
  }

  setHandlers(handlers: PushToTalkHandlers) {
    this.handlers = handlers;
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    await preferencesService.setHardwarePttEnabled(enabled);
  }

  getDetectedKey() {
    return this.detectedKey;
  }

  async detectNextKey(): Promise<HardwareKey> {
    this.detecting = true;
    return new Promise((resolve) => {
      this.detectResolver = resolve;
    });
  }

  private handleNativeKey(event: NativeHardwareKeyEvent) {
    if (this.detecting) {
      const detected: HardwareKey = { code: event.code, key: event.key };
      this.finishDetection(detected);
      return;
    }

    if (!this.enabled || !this.detectedKey || event.code !== this.detectedKey.code) {
      return;
    }

    if (event.action === 'down') {
      if (this.pressedKeys.has(event.code)) {
        return;
      }
      this.pressedKeys.add(event.code);
      this.handlers.onStart?.();
      return;
    }

    if (!this.pressedKeys.has(event.code)) {
      return;
    }
    this.pressedKeys.delete(event.code);
    this.handlers.onStop?.();
  }

  private finishDetection(detected: HardwareKey) {
    this.detecting = false;
    this.detectedKey = detected;
    void preferencesService.setHardwareKey(detected);
    if (this.detectResolver) {
      this.detectResolver(detected);
      this.detectResolver = null;
    }
  }

  private handleKeyDown = async (event: KeyboardEvent) => {
    const code = event.code || event.key;
    if (!code) {
      return;
    }

    if (this.detecting) {
      this.finishDetection({ code, key: event.key });
      return;
    }

    if (!this.enabled || !this.detectedKey) {
      return;
    }

    if (code !== this.detectedKey.code) {
      return;
    }

    if (event.repeat || this.pressedKeys.has(code)) {
      return;
    }

    this.pressedKeys.add(code);
    this.handlers.onStart?.();
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    const code = event.code || event.key;
    if (!code || !this.enabled || !this.detectedKey) {
      return;
    }

    if (code !== this.detectedKey.code) {
      return;
    }

    if (!this.pressedKeys.has(code)) {
      return;
    }

    this.pressedKeys.delete(code);
    this.handlers.onStop?.();
  };
}

export const hardwareButtonService = new HardwareButtonService();
