package com.zanci19.wavelink;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ForegroundServicePlugin.class);
        registerPlugin(HardwareKeyPlugin.class);
        super.onCreate(savedInstanceState);
        configureWebViewForVoice();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        forwardHardwareKey(event);
        return super.dispatchKeyEvent(event);
    }

    private void configureWebViewForVoice() {
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        bridge.getWebView().post(() -> {
            WebSettings settings = bridge.getWebView().getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        });
    }

    private void forwardHardwareKey(KeyEvent event) {
        if (bridge == null) {
            return;
        }
        PluginHandle handle = bridge.getPlugin("HardwareKey");
        if (handle == null || handle.getInstance() == null) {
            return;
        }
        ((HardwareKeyPlugin) handle.getInstance()).notifyHardwareKey(event);
    }
}
