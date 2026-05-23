package com.zanci19.wavelink;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.zanci19.wavelink.service.ForegroundService;

@CapacitorPlugin(name = "ForegroundService")
public class ForegroundServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String roomCode = call.getString("roomCode", "");

        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        serviceIntent.putExtra("roomCode", roomCode);
        getContext().startForegroundService(serviceIntent);

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        getContext().stopService(serviceIntent);

        call.resolve();
    }
}
