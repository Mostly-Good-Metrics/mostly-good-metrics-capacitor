# Offline Android bridge regression

This private fixture runs the built Capacitor SDK and JavaScript core in an
actual Android WebView, using real App, Device, and Preferences plugins. It
checks identity and consent restoration, cyclic property capture, 30
configure/destroy cycles, native background/foreground events, and host errors.
It disables fetch and supplies an offline network adapter. It only clears
storage in the generated `com.mgm.offline.safetyhost` application's sandbox.

The fixture uses Capacitor 6 on Java 17 as a supported native compatibility
case. It does not establish coverage for every Capacitor/plugin/OS version.
Mocked fault-injection tests remain necessary for stalled and throwing plugins.

From the SDK root, after building the SDK and booting a dedicated emulator:

```sh
npm ci
npm run build
cd tests/native-host
npm ci --ignore-scripts --no-audit --no-fund
node build-probe.mjs
npx cap add android
cd android
./gradlew :app:assembleDebug --console=plain
cd ..
python3 run-native.py
```

Set `JAVA_HOME` to a Java 17 installation and `ANDROID_HOME` to the Android
SDK. Set `ANDROID_SERIAL` when multiple devices are connected. The runner
launches and stops only its own generated test app.

By default, the bundle uses the core installed by this SDK. Set `MGM_JS_DIR`
to a separately built JavaScript SDK checkout to validate a candidate core.
The draft workflow pins the companion crash fix this way; publication must
update the wrapper's minimum dependency and remove the candidate override.
