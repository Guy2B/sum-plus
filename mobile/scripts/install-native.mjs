#!/usr/bin/env node
/**
 * Idempotently wires the Σ health plugins into the Capacitor native projects.
 * Safe to run after every `npx cap add` / `npx cap sync`.
 *
 * Android: Kotlin + Health Connect deps, minSdk 26, health permissions,
 *          permission-rationale entry points, plugin registration, no backups.
 * iOS:     plugin + bridge view controller added to the Xcode target,
 *          HealthKit entitlement and usage description.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const write = (p, s) => writeFileSync(join(root, p), s);
const log = (m) => console.log(`• ${m}`);

function patch(file, fn) {
  if (!existsSync(join(root, file))) return log(`skip ${file} (platform not added)`);
  const before = read(file);
  const after = fn(before);
  if (after !== before) {
    write(file, after);
    log(`patched ${file}`);
  }
}

function copy(from, to) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
  log(`copied ${to}`);
}

/* --------------------------------- Android --------------------------------- */

if (existsSync(join(root, 'android'))) {
  copy(
    'native/android/SigmaHealthPlugin.kt',
    'android/app/src/main/java/com/algbr/sigma/health/SigmaHealthPlugin.kt',
  );

  patch('android/variables.gradle', (s) => s.replace(/minSdkVersion = \d+/, 'minSdkVersion = 26'));

  patch('android/build.gradle', (s) =>
    s.includes('kotlin-gradle-plugin')
      ? s
      : s.replace(
          "classpath 'com.android.tools.build:gradle:",
          "classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21'\n        classpath 'com.android.tools.build:gradle:",
        ),
  );

  patch('android/app/build.gradle', (s) => {
    let out = s;
    if (!out.includes("apply plugin: 'kotlin-android'")) {
      out = out.replace(
        "apply plugin: 'com.android.application'",
        "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'",
      );
    }
    if (!out.includes('JavaVersion.VERSION_17')) {
      out = out.replace(
        /android \{\n/,
        'android {\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }\n    kotlinOptions {\n        jvmTarget = "17"\n    }\n',
      );
    }
    if (!out.includes('connect-client')) {
      out = out.replace(
        "implementation project(':capacitor-android')",
        "implementation project(':capacitor-android')\n    implementation 'androidx.health.connect:connect-client:1.1.0'\n    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0'\n    implementation 'androidx.activity:activity-ktx:1.9.3'",
      );
    }
    return out;
  });

  patch('android/app/src/main/java/com/algbr/sigma/MainActivity.java', (s) =>
    s.includes('SigmaHealthPlugin')
      ? s
      : `package com.algbr.sigma;

import android.os.Bundle;
import com.algbr.sigma.health.SigmaHealthPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(SigmaHealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`,
  );

  patch('android/app/src/main/AndroidManifest.xml', (s) => {
    let out = s;
    // Health data lives in the WebView's storage: never include it in cloud/device backups.
    out = out.replace(
      'android:allowBackup="true"',
      'android:allowBackup="false"\n        android:fullBackupContent="false"\n        android:dataExtractionRules="@xml/data_extraction_rules"',
    );
    if (!out.includes('android.permission.health.READ_STEPS')) {
      out = out.replace(
        '<uses-permission android:name="android.permission.INTERNET" />',
        `<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.health.READ_STEPS" />
    <uses-permission android:name="android.permission.health.READ_SLEEP" />
    <uses-permission android:name="android.permission.health.READ_EXERCISE" />
    <uses-permission android:name="android.permission.health.READ_RESTING_HEART_RATE" />

    <queries>
        <package android:name="com.google.android.apps.healthdata" />
    </queries>`,
      );
    }
    if (!out.includes('ACTION_SHOW_PERMISSIONS_RATIONALE')) {
      out = out.replace(
        `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
`,
        `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Health Connect privacy-policy entry point (Android 13 and below). -->
            <intent-filter>
                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
            </intent-filter>
`,
      );
      out = out.replace(
        '        <provider',
        `        <!-- Health Connect privacy-policy entry point (Android 14+). -->
        <activity-alias
            android:name="ViewPermissionUsageActivity"
            android:exported="true"
            android:targetActivity=".MainActivity"
            android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
            <intent-filter>
                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
                <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
            </intent-filter>
        </activity-alias>

        <provider`,
      );
    }
    return out;
  });

  const rules = 'android/app/src/main/res/xml/data_extraction_rules.xml';
  if (!existsSync(join(root, rules))) {
    mkdirSync(dirname(join(root, rules)), { recursive: true });
    write(
      rules,
      `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup><exclude domain="root" /><exclude domain="database" /><exclude domain="sharedpref" /><exclude domain="file" /></cloud-backup>
    <device-transfer><exclude domain="root" /><exclude domain="database" /><exclude domain="sharedpref" /><exclude domain="file" /></device-transfer>
</data-extraction-rules>
`,
    );
    log(`created ${rules}`);
  }
}

/* ----------------------------------- iOS ----------------------------------- */

if (existsSync(join(root, 'ios/App'))) {
  copy('native/ios/SigmaHealthPlugin.swift', 'ios/App/App/SigmaHealthPlugin.swift');
  write(
    'ios/App/App/SigmaBridgeViewController.swift',
    `import Capacitor

/// Registers Σ's local native plugins with the Capacitor bridge.
class SigmaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SigmaHealthPlugin())
    }
}
`,
  );
  write(
    'ios/App/App/App.entitlements',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.healthkit</key>
    <true/>
    <key>com.apple.developer.healthkit.access</key>
    <array/>
</dict>
</plist>
`,
  );

  patch('ios/App/App/Base.lproj/Main.storyboard', (s) =>
    s.replace(
      'customClass="CAPBridgeViewController" customModule="Capacitor"',
      'customClass="SigmaBridgeViewController" customModule="App" customModuleProvider="target"',
    ),
  );

  patch('ios/App/App/Info.plist', (s) =>
    s.includes('NSHealthShareUsageDescription')
      ? s
      : s.replace(
          /<dict>\n/,
          `<dict>
	<key>NSHealthShareUsageDescription</key>
	<string>Σ lit vos résumés quotidiens de sommeil, de pas et d’activité pour adapter votre charge de travail. Ces données restent sur votre appareil sauf si vous activez la synchronisation.</string>
`,
        ),
  );

  // Xcode project: deterministic IDs keep the patch idempotent.
  const IDS = {
    pluginRef: 'A51C0DE0000000000000A001',
    pluginBuild: 'A51C0DE0000000000000A002',
    bridgeRef: 'A51C0DE0000000000000A003',
    bridgeBuild: 'A51C0DE0000000000000A004',
    entRef: 'A51C0DE0000000000000A005',
  };
  patch('ios/App/App.xcodeproj/project.pbxproj', (s) => {
    if (s.includes(IDS.pluginRef)) return s;
    let out = s;
    out = out.replace(
      '/* End PBXBuildFile section */',
      `\t\t${IDS.pluginBuild} /* SigmaHealthPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${IDS.pluginRef} /* SigmaHealthPlugin.swift */; };
\t\t${IDS.bridgeBuild} /* SigmaBridgeViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${IDS.bridgeRef} /* SigmaBridgeViewController.swift */; };
/* End PBXBuildFile section */`,
    );
    out = out.replace(
      '/* End PBXFileReference section */',
      `\t\t${IDS.pluginRef} /* SigmaHealthPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SigmaHealthPlugin.swift; sourceTree = "<group>"; };
\t\t${IDS.bridgeRef} /* SigmaBridgeViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SigmaBridgeViewController.swift; sourceTree = "<group>"; };
\t\t${IDS.entRef} /* App.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = App.entitlements; sourceTree = "<group>"; };
/* End PBXFileReference section */`,
    );
    out = out.replace(
      /(504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/,\n)/,
      `$1\t\t\t\t${IDS.pluginRef} /* SigmaHealthPlugin.swift */,\n\t\t\t\t${IDS.bridgeRef} /* SigmaBridgeViewController.swift */,\n\t\t\t\t${IDS.entRef} /* App.entitlements */,\n`,
    );
    out = out.replace(
      /(504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/,\n)/,
      `$1\t\t\t\t${IDS.pluginBuild} /* SigmaHealthPlugin.swift in Sources */,\n\t\t\t\t${IDS.bridgeBuild} /* SigmaBridgeViewController.swift in Sources */,\n`,
    );
    out = out.replace(
      /CODE_SIGN_STYLE = Automatic;\n(\t+)CURRENT_PROJECT_VERSION/g,
      'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n$1CODE_SIGN_STYLE = Automatic;\n$1CURRENT_PROJECT_VERSION',
    );
    out = out.replace(
      /(504EC3031FED79650016851F = \{\n\t+CreatedOnToolsVersion = 9\.2;\n)/,
      `$1\t\t\t\t\t\tSystemCapabilities = {\n\t\t\t\t\t\t\tcom.apple.HealthKit = {\n\t\t\t\t\t\t\t\tenabled = 1;\n\t\t\t\t\t\t\t};\n\t\t\t\t\t\t};\n`,
    );
    return out;
  });
}

console.log('Native projects are wired for Σ health bridges.');
