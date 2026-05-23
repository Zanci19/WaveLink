import { Preferences } from '@capacitor/preferences';

export interface HardwareKey {
  code: string;
  key: string;
}

const Keys = {
  lastRoomCode: 'wavelink.lastRoomCode',
  displayName: 'wavelink.displayName',
  hardwarePttEnabled: 'wavelink.hardwarePttEnabled',
  hardwareKey: 'wavelink.hardwareKey',
};

const readJson = async <T>(key: string): Promise<T | null> => {
  const { value } = await Preferences.get({ key });
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const writeJson = async <T>(key: string, data: T) => {
  await Preferences.set({ key, value: JSON.stringify(data) });
};

export const preferencesService = {
  async getLastRoomCode(): Promise<string | null> {
    return Preferences.get({ key: Keys.lastRoomCode }).then((result) => result.value ?? null);
  },
  async setLastRoomCode(code: string) {
    await Preferences.set({ key: Keys.lastRoomCode, value: code });
  },
  async clearLastRoomCode() {
    await Preferences.remove({ key: Keys.lastRoomCode });
  },
  async getDisplayName(): Promise<string | null> {
    return Preferences.get({ key: Keys.displayName }).then((result) => result.value ?? null);
  },
  async setDisplayName(displayName: string) {
    await Preferences.set({ key: Keys.displayName, value: displayName });
  },
  async getHardwarePttEnabled(): Promise<boolean> {
    const { value } = await Preferences.get({ key: Keys.hardwarePttEnabled });
    return value === 'true';
  },
  async setHardwarePttEnabled(enabled: boolean) {
    await Preferences.set({ key: Keys.hardwarePttEnabled, value: enabled ? 'true' : 'false' });
  },
  async getHardwareKey(): Promise<HardwareKey | null> {
    return readJson<HardwareKey>(Keys.hardwareKey);
  },
  async setHardwareKey(key: HardwareKey) {
    await writeJson(Keys.hardwareKey, key);
  },
  async clearHardwareKey() {
    await Preferences.remove({ key: Keys.hardwareKey });
  },
};
