/// <reference types="@capawesome/capacitor-android-edge-to-edge-support" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zanci19.wavelink',
  appName: 'WaveLink',
  webDir: 'dist',
  plugins: {
    EdgeToEdge: {
      statusBarColor: '#080d0b',
      navigationBarColor: '#080d0b',
    },
    Keyboard: {
      resizeOnFullScreen: false,
    },
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
};

export default config;
