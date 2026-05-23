import { HardwareKey, preferencesService } from './preferences/preferencesService';

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

  async initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    await this.refreshPreferences();
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
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

  private handleKeyDown = async (event: KeyboardEvent) => {
    const code = event.code || event.key;
    if (!code) {
      return;
    }

    if (this.detecting) {
      const detected: HardwareKey = { code, key: event.key };
      this.detecting = false;
      this.detectedKey = detected;
      await preferencesService.setHardwareKey(detected);
      if (this.detectResolver) {
        this.detectResolver(detected);
        this.detectResolver = null;
      }
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
