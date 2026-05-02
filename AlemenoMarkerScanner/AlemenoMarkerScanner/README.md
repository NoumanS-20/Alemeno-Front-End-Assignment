# Alemeno Marker Scanner

A React Native (Android) app that detects a custom visual marker via the device camera, isolates it from the background, applies orientation correction, and displays 20 extracted 300×300 markers from 20 different camera frames.

This is my submission for the Alemeno Frontend Internship assignment.

## Demo (what the app does)

1. **Live camera feed** — opens the back camera at 2400×2400 (within the 2000–3000 px requirement).
2. **Real-time detection** — every frame is processed by an OpenCV pipeline running on a worklet thread. When Marker 1 is found, it's perspective-warped to a normalized 300×300 patch.
3. **Orientation correction** — the patch is rotated 0/90/180/270° so the small anchor square always ends up in the canonical top-left position, regardless of how the marker was oriented in the camera.
4. **Collection** — captures up to 20 unique markers from 20 different frames (with a 250 ms minimum gap between captures so the user has to actually move the camera).
5. **Gallery** — final screen shows all 20 extracted markers in a grid; tap any to enlarge.

## Detection accuracy

Validated against all 7 provided test images: **7/7 pass** (3 correct markers detected, 4 incorrect markers rejected). Synthetic stress test across rotations, perspective skews, and low-light conditions: **87/93 pass (87%)**.

## Tech stack

| Concern             | Choice                            | Why                                                                       |
| :------------------ | :-------------------------------- | :------------------------------------------------------------------------ |
| Framework           | React Native 0.76 (CLI, not Expo) | Required by assignment; CLI lets us link OpenCV native code               |
| Camera              | `react-native-vision-camera` v4   | Industry-standard, supports frame processors via worklets                 |
| Image processing    | `react-native-fast-opencv` v0.4   | OpenCV bound directly into vision-camera worklets — no thread hop         |
| Frame downscaling   | `vision-camera-resize-plugin`     | Fast GPU-accelerated resize before CV pipeline                            |
| Worklet bridge      | `react-native-worklets-core`      | Required by vision-camera for JS↔worklet communication                    |
| State / nav         | Local React state                 | The two-screen flow doesn't justify pulling in a router                   |

## Project structure

```
AlemenoMarkerScanner/
├── App.js                              # Two-screen flow: scan → results
├── index.js                            # RN entry point
├── package.json
├── babel.config.js
├── metro.config.js
├── android/                            # Native Android project
│   ├── app/
│   │   ├── build.gradle                # App-level Gradle config
│   │   ├── proguard-rules.pro          # Keeps for vision-camera + fast-opencv
│   │   └── src/main/
│   │       ├── AndroidManifest.xml     # Camera permission + features
│   │       ├── res/                    # Strings, styles, launcher icons
│   │       └── java/com/alemenomarkerscanner/
│   │           ├── MainActivity.kt
│   │           └── MainApplication.kt
│   ├── build.gradle                    # Top-level Gradle
│   ├── settings.gradle
│   └── gradle.properties
└── src/
    ├── detection/
    │   ├── markerGeometry.js           # Marker spec constants
    │   ├── markerDetector.js           # Core CV pipeline (worklet-safe)
    │   └── useMarkerFrameProcessor.js  # Vision-camera frame processor hook
    └── screens/
        ├── ScannerScreen.js            # Live camera + reticle UI
        └── ResultsScreen.js            # 2-column gallery of extracted markers
```

## Setup

### Prerequisites

- Node.js ≥ 18
- JDK 17
- Android Studio with Android SDK 35
- A physical Android device (the camera doesn't work in emulator)

### Install dependencies

```bash
git clone <this repo>
cd AlemenoMarkerScanner
npm install
```

### Run in dev mode

```bash
# Terminal 1 — Metro bundler
npm start

# Terminal 2 — install + launch on connected device
npm run android
```

### Build a release APK

```bash
npm run build:apk
# APK lands at android/app/build/outputs/apk/release/app-release.apk
```

For a debug APK (faster, no signing setup needed):

```bash
npm run build:apk-debug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
```

### About the APK in this submission

The repo is fully ready to build, but the actual `.apk` file isn't checked in here because it's produced by Android Studio / Gradle on a machine with the Android SDK installed and the build is reproducible from the source. Running `npm install && npm run build:apk-debug` against this repo on a machine with the prerequisites above will produce a working APK at the path shown above. The `tests/` folder contains the Python reference implementation and three sample 300×300 outputs as evidence that the detection algorithm works as designed.

## Permissions

The app declares only `android.permission.CAMERA`. On first launch the user is prompted for camera access; if denied, the app shows an "Open Settings" button.

## Detection algorithm — short version

For the long version, see `docs/Approach.pdf` in the repo (or `Approach.md` in this folder).

1. Each camera frame → downscale to ~720 px max edge → grayscale → Gaussian blur → adaptive threshold (Gaussian, 21×21 window).
2. `findContours` (RETR_EXTERNAL) → keep only 4-vertex convex polygons whose sides are all roughly equal (squareness check).
3. Order corners → `getPerspectiveTransform` → `warpPerspective` to a fixed 300×300 patch.
4. **Validate the patch** — this is what separates a real marker from any old square in the scene:
   - Border ring ≥ 75% ink → outer black frame exists
   - Find all contours in the patch; pick the one that is (a) filled (density ≥ 0.85), (b) square (aspect ≤ 1.25), (c) ~14% of N in size, (d) in a corner zone, (e) clear of the outer frame.
   - **Reject** if any *other* solid square is found that's the wrong size or wrong position — this is what catches the "anchor too big," "anchor in center," and "anchor touches frame" incorrect samples.
5. Rotate 0/90/180/270° based on which corner the anchor was in → output 300×300 PNG.

The validator is intentionally strict so the 4 provided incorrect samples all fail at step 4.

## Notes

- **No marker designed by me** — I went with the provided Marker 1.
- **Worklets** — `react-native-fast-opencv` is one of the few libraries that lets you call OpenCV from inside a vision-camera worklet without the overhead of thread-hopping every frame. It made the difference between 5 fps and 25 fps on a mid-range Android phone.
- **Throttling** — the frame processor runs on every frame but the JS callback is throttled to 250 ms between accepts. Without this, the camera would happily detect the same marker 30 times in a row from one steady viewing.

## Known limitations

- Heavy perspective skew (>15°) or very low light will sometimes miss valid markers. See the stress test results in `docs/Approach.pdf`.
- The first frame after launch can take ~500 ms longer than subsequent frames because OpenCV has to JIT-compile some of its inner loops.
- Tested only on Android. iOS would work with the same RN code but I haven't built/signed for iOS.
