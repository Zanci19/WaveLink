package com.zanci19.wavelink;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

public class HardwareKeyAccessibilityService extends AccessibilityService {
    @Override
    protected void onServiceConnected() {
        AccessibilityServiceInfo serviceInfo = getServiceInfo();
        if (serviceInfo != null) {
            serviceInfo.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            setServiceInfo(serviceInfo);
        }
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        HardwareKeyPlugin.notifyHardwareKeyFromBackground(event);
        return false;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Key filtering is the only accessibility capability WaveLink uses.
    }

    @Override
    public void onInterrupt() {
        // Nothing to interrupt.
    }
}
