package com.shram.sitediary;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SiteSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
