import { Capacitor } from '@capacitor/core';

export const openAppSettings = async () => {
  // TODO: On Android, consider a native plugin to open the exact app settings screen if needed.
  const url = 'app-settings:';
  if (Capacitor.isNativePlatform()) {
    window.open(url, '_system');
    return;
  }
  window.open(url, '_blank');
};
