package com.zanci19.wavelink;

import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "HardwareKey")
public class HardwareKeyPlugin extends Plugin {
    private static WeakReference<HardwareKeyPlugin> activeInstance = new WeakReference<>(null);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        activeInstance = new WeakReference<>(this);
    }

    @PluginMethod
    public void isBackgroundCaptureEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", isAccessibilityServiceEnabled());
        result.put("serviceName", getAccessibilityServiceComponent().flattenToString());
        call.resolve(result);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        openSettingsIntent(call, new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName())
        );
        openSettingsIntent(call, intent);
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        openSettingsIntent(call, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName())
            );
        }
        openSettingsIntent(call, intent);
    }

    public static void notifyHardwareKeyFromBackground(KeyEvent event) {
        HardwareKeyPlugin plugin = activeInstance.get();
        if (plugin != null) {
            plugin.notifyHardwareKey(event);
        }
    }

    public void notifyHardwareKey(KeyEvent event) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> notifyHardwareKey(event));
            return;
        }

        if (!hasListeners("hardwareKey")) {
            return;
        }

        int action = event.getAction();
        if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) {
            return;
        }

        JSObject payload = new JSObject();
        payload.put("code", keyCodeToDomCode(event.getKeyCode()));
        payload.put("key", KeyEvent.keyCodeToString(event.getKeyCode()).replace("KEYCODE_", ""));
        payload.put("action", action == KeyEvent.ACTION_DOWN ? "down" : "up");
        notifyListeners("hardwareKey", payload);
    }

    private void openSettingsIntent(PluginCall call, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception exception) {
            call.reject("Unable to open Android settings", exception);
        }
    }

    private boolean isAccessibilityServiceEnabled() {
        int accessibilityEnabled;
        try {
            accessibilityEnabled = Settings.Secure.getInt(
                getContext().getContentResolver(),
                Settings.Secure.ACCESSIBILITY_ENABLED
            );
        } catch (Settings.SettingNotFoundException exception) {
            return false;
        }

        if (accessibilityEnabled != 1) {
            return false;
        }

        String enabledServices = Settings.Secure.getString(
            getContext().getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        if (enabledServices == null) {
            return false;
        }

        ComponentName serviceComponent = getAccessibilityServiceComponent();
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabledServices);
        while (splitter.hasNext()) {
            ComponentName enabledComponent = ComponentName.unflattenFromString(splitter.next());
            if (serviceComponent.equals(enabledComponent)) {
                return true;
            }
        }
        return false;
    }

    private ComponentName getAccessibilityServiceComponent() {
        return new ComponentName(getContext(), HardwareKeyAccessibilityService.class);
    }

    private static String keyCodeToDomCode(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_F1:
                return "F1";
            case KeyEvent.KEYCODE_F2:
                return "F2";
            case KeyEvent.KEYCODE_F3:
                return "F3";
            case KeyEvent.KEYCODE_F4:
                return "F4";
            case KeyEvent.KEYCODE_F5:
                return "F5";
            case KeyEvent.KEYCODE_F6:
                return "F6";
            case KeyEvent.KEYCODE_F7:
                return "F7";
            case KeyEvent.KEYCODE_F8:
                return "F8";
            case KeyEvent.KEYCODE_F9:
                return "F9";
            case KeyEvent.KEYCODE_F10:
                return "F10";
            case KeyEvent.KEYCODE_F11:
                return "F11";
            case KeyEvent.KEYCODE_F12:
                return "F12";
            case KeyEvent.KEYCODE_SPACE:
                return "Space";
            case KeyEvent.KEYCODE_ENTER:
                return "Enter";
            case KeyEvent.KEYCODE_TAB:
                return "Tab";
            case KeyEvent.KEYCODE_ESCAPE:
                return "Escape";
            case KeyEvent.KEYCODE_VOLUME_UP:
                return "VolumeUp";
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                return "VolumeDown";
            case KeyEvent.KEYCODE_VOLUME_MUTE:
                return "VolumeMute";
            case KeyEvent.KEYCODE_HEADSETHOOK:
                return "HeadsetHook";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                return "MediaPlayPause";
            case KeyEvent.KEYCODE_CAMERA:
                return "Camera";
            case KeyEvent.KEYCODE_PROG_RED:
                return "ProgRed";
            case KeyEvent.KEYCODE_PROG_GREEN:
                return "ProgGreen";
            case KeyEvent.KEYCODE_PROG_YELLOW:
                return "ProgYellow";
            case KeyEvent.KEYCODE_PROG_BLUE:
                return "ProgBlue";
            default:
                return "Key" + keyCode;
        }
    }
}
