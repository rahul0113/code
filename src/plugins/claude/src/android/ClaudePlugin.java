package com.foxdebug.acode.claude;

import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Minimal Cordova plugin stub for the Claude integration.
 *
 * The actual communication happens via WebSocket from JavaScript.
 * This plugin exists so Cordova recognizes the feature and can be
 * extended later with native capabilities if needed (e.g., background
 * service for long-running Claude tasks).
 */
public class ClaudePlugin extends CordovaPlugin {

    private static final String TAG = "ClaudePlugin";

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext)
            throws JSONException {
        Log.d(TAG, "execute: " + action);
        // Reserved for future native operations
        callbackContext.error("Not implemented yet");
        return true;
    }
}
