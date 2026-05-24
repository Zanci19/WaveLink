import { registerPlugin } from '@capacitor/core';

export type NativeHardwareKeyAction = 'down' | 'up';

export interface NativeHardwareKeyEvent {
  code: string;
  key: string;
  action: NativeHardwareKeyAction;
}

export interface HardwareKeyBackgroundCaptureStatus {
  supported: boolean;
  enabled: boolean;
  serviceName?: string;
}

export interface HardwareKeyPluginType {
  addListener(
    eventName: 'hardwareKey',
    listenerFunc: (event: NativeHardwareKeyEvent) => void
  ): Promise<{ remove: () => void }>;
  isBackgroundCaptureEnabled(): Promise<HardwareKeyBackgroundCaptureStatus>;
  openAccessibilitySettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  openBatteryOptimizationSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
}

export const HardwareKeyPlugin = registerPlugin<HardwareKeyPluginType>('HardwareKey');
