package com.algbr.lifeos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugin: silent Google authorization for automatic syncs.
        registerPlugin(SigmaGooglePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
