import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

const SYSTEM_BAR_COLOR = '#080d0b';

class EdgeToEdgeService {
  async initialize() {
    if (Capacitor.getPlatform() !== 'android') {
      return;
    }

    try {
      await EdgeToEdge.enable();
      await SystemBars.setStyle({ style: SystemBarsStyle.Dark });
      await EdgeToEdge.setStatusBarColor({ color: SYSTEM_BAR_COLOR });
      await EdgeToEdge.setNavigationBarColor({ color: SYSTEM_BAR_COLOR });
    } catch (error) {
      console.warn('Edge-to-edge initialization failed:', error);
    }
  }
}

export const edgeToEdgeService = new EdgeToEdgeService();
