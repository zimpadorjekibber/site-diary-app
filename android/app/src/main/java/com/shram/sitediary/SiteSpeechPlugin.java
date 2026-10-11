package com.shram.sitediary;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

@CapacitorPlugin(name = "SiteSpeech", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class SiteSpeechPlugin extends Plugin {
    private boolean pending = false;

    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> begin(call));
    }

    private void begin(PluginCall call) {
        if (pending) { call.reject("Voice input is already open", "BUSY"); return; }
        pending = true;
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionResult");
        } else { launchRecognizer(call); }
    }

    @PermissionCallback
    private void microphonePermissionResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pending = false;
            call.reject("Microphone permission denied", "PERMISSION_DENIED");
            return;
        }
        launchRecognizer(call);
    }

    private void launchRecognizer(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "hi-IN"));
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "जैसे: रमेश को 500 रुपये दिए"));
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        try { startActivityForResult(call, intent, "speechResult"); }
        catch (ActivityNotFoundException e) {
            pending = false;
            call.reject("No speech recognition app available", "UNAVAILABLE", e);
        } catch (SecurityException e) {
            pending = false;
            call.reject("Microphone access blocked", "PERMISSION_DENIED", e);
        } catch (RuntimeException e) {
            pending = false;
            call.reject("Speech recognition could not start", "FAILED", e);
        }
    }

    @ActivityCallback
    private void speechResult(PluginCall call, ActivityResult result) {
        pending = false;
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.reject("Voice input cancelled", "CANCELLED"); return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            String code = result.getResultCode() == RecognizerIntent.RESULT_NETWORK_ERROR || result.getResultCode() == RecognizerIntent.RESULT_SERVER_ERROR ? "NETWORK" : result.getResultCode() == RecognizerIntent.RESULT_AUDIO_ERROR ? "AUDIO_CAPTURE" : "NO_SPEECH";
            call.reject("Speech recognition failed", code); return;
        }
        ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String text = matches == null || matches.isEmpty() || matches.get(0) == null ? "" : matches.get(0).trim();
        if (text.isEmpty()) { call.reject("No speech recognized", "NO_SPEECH"); return; }
        JSObject response = new JSObject(); response.put("text", text); call.resolve(response);
    }
}
