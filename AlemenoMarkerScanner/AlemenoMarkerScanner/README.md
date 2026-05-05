# Alemeno Marker Scanner

A React Native (Android) app that detects a custom visual marker via the device camera, isolates it, applies orientation correction, and displays 20 extracted **300×300** marker patches captured from 20 different camera frames.

Submission for the Alemeno Frontend Internship assignment.

## What the app does

1. **Live camera feed** — opens the back camera at the device's highest stable resolution (typically 4K). The frame processor centre-crops a square ROI within the assignment's 2000–3000 px range and analyses it.
2. **Real-time detection** — every frame is processed by an OpenCV pipeline running on a vision-camera worklet thread. When Marker 1 is found, it's perspective-warped to a normalized 300×300 patch.
3. **Orientation correction** — the patch is rotated 0/90/180/270° so the small anchor square always ends up in the canonical top-left position, regardless of how the marker was oriented in the camera.
4. **Collection** — captures up to 20 unique markers from 20 different frames (with an 80 ms minimum gap between accepts so the entire scan finishes well under the 3000 ms budget).
5. **Gallery** — final screen shows all 20 extracted markers in a grid; tap any to enlarge.

## Detection accuracy

Validated against all 7 provided test images: **7/7 pass** (3 correct markers detected, 4 incorrect markers rejected). Synthetic stress test across rotations, perspective skews, and low-light conditions: **81/93 pass (87.1 %)**. See [`docs/Approach.md`](docs/Approach.md) for the full algorithm + per-image results.

## Tech stack

| Concern             | Choice                            | Why                                                                  |
| :------------------ | :-------------------------------- | :------------------------------------------------------------------- |
| Framework           | React Native 0.76 (CLI, not Expo) | Required by assignment; CLI lets us link OpenCV native code          |
| Camera              | `react-native-vision-camera` v4   | Industry-standard, supports frame processors via worklets            |
| Image processing    | `react-native-fast-opencv` v0.4   | OpenCV bound directly into vision-camera worklets — no thread hop    |
| Frame downscaling   | `vision-camera-resize-plugin`     | GPU-accelerated crop + resize before CV pipeline                     |
| Worklet bridge      | `react-native-worklets-core`      | Required by vision-camera for JS↔worklet communication               |
| State / nav         | Local React state                 | The two-screen flow doesn't justify a router                         |

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
│   │   ├── debug.keystore              # Debug signing (generate locally if missing)
│   │   ├── proguard-rules.pro          # Keep rules for vision-camera + fast-opencv
│   │   └── src/main/
│   │       ├── AndroidManifest.xml     # Camera permission + features
│   │       ├── res/                    # Strings, styles, launcher icons
│   │       └── java/com/alemenomarkerscanner/
│   │           ├── MainActivity.kt
│   │           └── MainApplication.kt  # SoLoader uses OpenSourceMergedSoMapping (RN 0.76)
│   ├── build.gradle                    # Top-level Gradle
│   ├── settings.gradle
│   ├── gradle.properties
│   ├── gradlew / gradlew.bat
│   └── gradle/wrapper/                 # Gradle 8.10.2 wrapper
├── docs/
│   └── Approach.md                     # Long-form approach write-up
├── tests/
│   ├── detect_prototype.py             # Python reference detector
│   ├── README.md                       # How to run the prototype
│   └── sample-outputs/                 # Three reference 300×300 patches
└── src/
    ├── detection/
    │   ├── markerGeometry.js           # Marker spec constants
    │   ├── markerDetector.js           # Core CV pipeline (worklet-safe, fully inlined)
    │   └── useMarkerFrameProcessor.js  # Vision-camera frame processor hook
    └── screens/
        ├── ScannerScreen.js            # Live camera + reticle UI
        └── ResultsScreen.js            # 2-column gallery of extracted markers
```

## Setup

### Prerequisites

- Node.js ≥ 18
- JDK 17
- Android SDK 35 + NDK 26.1.10909125 (via Android Studio or command-line tools)
- A physical Android device with USB debugging enabled (the camera doesn't work in emulator)

### Install JS dependencies

```bash
git clone <this repo>
cd AlemenoMarkerScanner
npm install
```

> ⚠️ Avoid project paths that contain spaces or parentheses (e.g. `C:\Users\you\Downloads\files (1)\…`). The CMake/ninja toolchain used by `react-native-fast-opencv` and `react-native-reanimated` mangles such paths. Build from a clean path like `C:\dev\AlemenoMarkerScanner`.

### Generate a debug keystore (one-time, only if `android/app/debug.keystore` is absent)

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 \
  -keystore debug.keystore -storepass android \
  -alias androiddebugkey -keypass android \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Android Debug,O=Android,C=US"
```

### Run in dev mode

```bash
# Terminal 1 — Metro bundler
npm start

# Terminal 2 — install + launch on the connected device
npm run android
```

### Build a release APK with embedded JS bundle

```bash
npm run build:apk
# APK lands at android/app/build/outputs/apk/release/app-release.apk
```

For a debug APK (no signing setup beyond `debug.keystore`):

```bash
npm run build:apk-debug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
```

To install directly on a connected device:

```bash
cd android && ./gradlew app:installRelease
```

### About the APK in this submission

The repo is fully ready to build, but the actual `.apk` file isn't checked in — it's a build artefact reproducible from source. Running `npm install && npm run build:apk` against this repo on a machine with the prerequisites above will produce a working APK at the path shown. The `tests/sample-outputs/` folder contains three reference 300×300 patches as evidence the detection algorithm works.

## Permissions

The app declares only `android.permission.CAMERA`. On first launch the user is prompted for camera access; if denied, the app shows an "Open Settings" button.

## Detection algorithm — short version

For the long version, see [`docs/Approach.md`](docs/Approach.md).

1. **Centre-crop + downscale.** Crop a centred square from the camera frame (side ≈ `min(width, height)`, ~2160 px) and resize to **720 × 720** in a single GPU pass.
2. **Threshold.** Grayscale → 5×5 Gaussian blur → adaptive threshold (Gaussian, 21×21 window, offset 10, INV).
3. **Find candidates.** `findContours` (RETR_EXTERNAL) → for each contour large enough:
   - **Convex hull** (essential — strips moiré-induced jagged corners that a single `approxPolyDP` would otherwise treat as real vertices).
   - Multi-epsilon `approxPolyDP` (try 0.02 → 0.08 × perimeter, accept first 4-vertex result).
   - Order corners (TL, TR, BR, BL via the sum/diff trick); require shortest side ≥ 60 px and longest/shortest ≤ 2.5 (loose enough for perspective).
4. **Perspective warp** to a fixed 300×300 patch via `getPerspectiveTransform` + `warpPerspective`.
5. **Validate the patch** — what separates a real marker from any quadrilateral in the scene:
   - Border ring ink ratio ≥ 0.55 → outer black frame is present.
   - Centre 50 % region ink ratio ≤ 0.85 → not a fully-filled solid square.
   - Find every contour in the patch; pick those that are filled (density ≥ 0.85), square (aspect ≤ 1.25), 9–21 % of N in size, in a corner zone, and clear of the outer frame.
   - **Reject** if any *other* solid square is found that's the wrong size or wrong position — this catches the "anchor too big," "anchor centred," and "anchor touching frame" incorrect samples.
6. **Rotate** 0/90/180/270° based on which corner the anchor lives in, so the corrected output always has the anchor in the top-left:

   | Anchor location | Rotation                    |
   | :-------------- | :-------------------------- |
   | Top-left        | 0°                          |
   | Top-right       | 90° **counter-clockwise**   |
   | Bottom-right    | 180°                        |
   | Bottom-left     | 90° **clockwise**           |

7. **Encode** to base64 PNG and dispatch to JS.

The validator is intentionally strict so the 4 provided incorrect samples all fail at step 5.

## Performance notes

- **Worklet-resident OpenCV.** Frames never cross the JS bridge during processing — only the final 300×300 PNG (~30 KB) does.
- **Throttling.** Frame processor runs every frame; JS callback is throttled to 80 ms between accepts. With 20 captures × 80 ms ≈ 1.6 s plus camera warm-up, total scan-to-result is roughly 2 s.
- **Speed-up from downscaling.** `findContours` is roughly O(area). Analysing a 720×720 view of a 2160×2160 ROI gives a ~10× speed-up with no measurable accuracy loss for markers ≥ 60 px in the analysed view.

## Known limitations

- Heavy perspective skew (>15°) or very low light will sometimes miss valid markers. See the stress-test results in [`docs/Approach.md`](docs/Approach.md).
- The first frame after launch can take ~500 ms longer than subsequent frames because OpenCV has to JIT-compile some inner loops.
- Tested only on Android. iOS would work with the same RN code but I haven't built/signed for iOS.

## Troubleshooting

- **Build fails with `ninja: error: manifest 'build.ninja' still dirty after 100 tries`** — your project path contains a space or parens. Move the project to e.g. `C:\dev\AlemenoMarkerScanner` and rebuild.
- **App crashes on launch with `dlopen failed: library "libreact_featureflagsjni.so" not found`** — `MainApplication.kt` is using the pre-0.76 `SoLoader.init(this, false)`. Fix: `SoLoader.init(this, OpenSourceMergedSoMapping)` (already applied in this repo).
- **`Fast OpenCV Error: Argument (N) is not a Mat!`** — fast-opencv 0.4.x is strict about object types passed to `OpenCV.invoke`. The current `markerDetector.js` uses `ObjectType.Mat` / `DataTypes.*` enums everywhere; if you re-introduce string constants (`'Mat'`, `'Size'`, …) they won't match the C++ case statements.
- **`react-native-reanimated: Unsupported React Native version`** — pin `react-native-reanimated@3.16.7` (newer 3.19+ require RN ≥ 0.78).
