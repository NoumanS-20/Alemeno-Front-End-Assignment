# Tests

This folder contains a Python reference implementation of the detection algorithm and the outputs produced when it runs against the 7 official test images from the assignment zip.

## Files

- **`detect_prototype.py`** — A line-for-line Python port of `src/detection/markerDetector.js` using `cv2`. This was used during development to iterate on the detection logic without rebuilding the React Native app each time. The JS detector and this prototype implement the same algorithm.

- **`sample-outputs/`** — The orientation-corrected, 300×300 marker patches the prototype produces for the three "correct" test images. These are exactly what the React Native app will display in its results gallery.

## Running the prototype

```bash
pip install opencv-python-headless numpy
# Update the `base` path inside detect_prototype.py to point at the assignment's
# Marker1-TestImages directory, then:
python3 detect_prototype.py
```

## Expected output

```
Test                                             Expected   Got        Result
----------------------------------------------------------------------------------
Marker1-TestImage1-Correct.jpg                   ACCEPT     ACCEPT     ✓
Marker1-TestImage2-Correct.jpg                   ACCEPT     ACCEPT     ✓
Marker1-TestImage3-Correct.jpg                   ACCEPT     ACCEPT     ✓
Marker1-TestImage4-Incorrect.jpg                 REJECT     REJECT     ✓
Marker1-TestImage5-Incorrect.jpg                 REJECT     REJECT     ✓
Marker1-TestImage6-Incorrect.jpg                 REJECT     REJECT     ✓
Marker1-TestImage7-Incorrect.jpg                 REJECT     REJECT     ✓

7/7 tests passed
```

## Why a Python prototype?

OpenCV-on-mobile is slow to iterate (every change means a Metro reload + Gradle rebuild + APK push). Validating the algorithm itself against the official test images in pure Python first — and only porting the *proven* logic into JavaScript — saved hours and made the test result above reproducible by anyone with Python and OpenCV installed.
