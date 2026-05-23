package com.zanci19.wavelink;

import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HardwareKey")
public class HardwareKeyPlugin extends Plugin {

    public void notifyHardwareKey(KeyEvent event) {
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
