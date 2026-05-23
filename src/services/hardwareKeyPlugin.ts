import { registerPlugin } from '@capacitor/core';

export type NativeHardwareKeyAction = 'down' | 'up';

export interface NativeHardwareKeyEvent {
  code: string;
  key: string;
  action: NativeHardwareKeyAction;
}

export interface HardwareKeyPluginType {
  addListener(
    eventName: 'hardwareKey',
    listenerFunc: (event: NativeHardwareKeyEvent) => void
  ): Promise<{ remove: () => void }>;
}

export const HardwareKeyPlugin = registerPlugin<HardwareKeyPluginType>('HardwareKey');
