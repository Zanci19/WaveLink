import { Capacitor } from '@capacitor/core';
import { HardwareKeyPlugin } from './hardwareKeyPlugin';

export const openAppSettings = async () => {
  if (Capacitor.getPlatform() === 'android') {
    try {
      await HardwareKeyPlugin.openAppSettings();
      return;
    } catch {
      // Fall through to the generic app settings URL.
    }
  }

  const url = 'app-settings:';
  if (Capacitor.isNativePlatform()) {
    window.open(url, '_system');
    return;
  }
  window.open(url, '_blank');
};

export interface BackgroundPttPermissionStatus {
  supported: boolean;
  accessibilityEnabled: boolean;
}

export const getBackgroundPttPermissionStatus = async (): Promise<BackgroundPttPermissionStatus> => {
  if (Capacitor.getPlatform() !== 'android') {
    return {
      supported: false,
      accessibilityEnabled: false,
    };
  }

  try {
    const status = await HardwareKeyPlugin.isBackgroundCaptureEnabled();
    return {
      supported: status.supported,
      accessibilityEnabled: status.enabled,
    };
  } catch {
    return {
      supported: true,
      accessibilityEnabled: false,
    };
  }
};

export const openAccessibilitySettings = async () => {
  if (Capacitor.getPlatform() === 'android') {
    await HardwareKeyPlugin.openAccessibilitySettings();
    return;
  }
  await openAppSettings();
};

export const openBatteryOptimizationSettings = async () => {
  if (Capacitor.getPlatform() === 'android') {
    await HardwareKeyPlugin.openBatteryOptimizationSettings();
    return;
  }
  await openAppSettings();
};

export const openNotificationSettings = async () => {
  if (Capacitor.getPlatform() === 'android') {
    await HardwareKeyPlugin.openNotificationSettings();
    return;
  }
  await openAppSettings();
};
