"""
Prototype detector that mirrors the React Native detection algorithm
in markerDetector.js. We run this against the provided test images
to verify the algorithm produces the correct accept/reject decisions
BEFORE shipping the RN code.
"""
import cv2
import numpy as np
import os
import sys

OUTPUT_SIZE = 300
MIN_MARKER_PIXEL_SIZE = 60
SQUARENESS_TOLERANCE = 1.25
POLY_APPROX_EPSILON = 0.04
ANCHOR_SIZE_MIN_RATIO = 0.09
ANCHOR_SIZE_MAX_RATIO = 0.21
CORNER_ZONE_RATIO = 0.40
FRAME_THICKNESS_RATIO_MAX = 0.12

def order_corners(pts):
    pts = np.array(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = pts[:, 1] - pts[:, 0]
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=np.float32)

def squareness_ok(corners):
    sides = []
    for i in range(4):
        a = corners[i]; b = corners[(i+1) % 4]
        sides.append(np.linalg.norm(a - b))
    if min(sides) < MIN_MARKER_PIXEL_SIZE: return False
    if max(sides) / min(sides) > SQUARENESS_TOLERANCE: return False
    return True

def validate_warped(warped_gray, N=OUTPUT_SIZE):
    """Returns (rotation_steps, score) or None.

    Strategy: on the normalized N×N warped patch, look for a small,
    filled black square that:
      - has size ~14% of N (matching the 20/140 spec)
      - is roughly square (aspect ≤ 1.15)
      - is FILLED ink (not an outline contour)
      - sits in a corner region (40% inset)
      - does NOT touch the outer frame (clearance ≥ ~3% of N)
      - is the ONLY anchor-sized filled square in the image
    """
    _, binary = cv2.threshold(warped_gray, 128, 255, cv2.THRESH_BINARY_INV)

    # Border ink check (outer frame must exist)
    rw = max(2, int(N * 0.05))
    border_ratio = (
        binary[:rw, :].mean() +
        binary[-rw:, :].mean() +
        binary[rw:-rw, :rw].mean() +
        binary[rw:-rw, -rw:].mean()
    ) / 4 / 255
    if border_ratio < 0.75:
        return None

    # Center sanity check: a fully-filled solid black square would
    # have ratio ~1.0; we only need to reject that pathological case.
    # Markers can legitimately contain decorative content (the spec
    # explicitly says info can be encoded inside), so we allow up to
    # 70% center ink.
    m = int(N * 0.25)
    center_ratio = binary[m:-m, m:-m].mean() / 255
    if center_ratio > 0.70:
        return None

    # Find all filled blobs anywhere in the image
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    # Bands for what counts as anchor-sized.
    # 20/140 = 0.143; allow 0.10..0.20.
    SIZE_MIN = 0.09
    SIZE_MAX = 0.20
    CORNER_ZONE = N * CORNER_ZONE_RATIO
    FRAME_CLEAR = N * 0.03  # min distance from frame edge

    anchor_candidates = []
    # Also count any "anchor-sized" blobs that disqualify (too big,
    # wrong aspect, or filled but in wrong place) — they're all
    # symptoms of an INCORRECT marker.
    disqualifying_blobs = 0

    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        side = (w + h) / 2
        if side < N * 0.04:
            continue
        rs = side / N
        aspect = max(w, h) / max(1, min(w, h))

        # Skip contours that ARE the outer frame
        if w > N * 0.80 and h > N * 0.80:
            continue

        # Filled-ness: how much of the bounding box is ink?
        mask = np.zeros(binary.shape, dtype=np.uint8)
        cv2.drawContours(mask, [c], -1, 255, -1)
        bbox_area = w * h
        if bbox_area == 0:
            continue
        contour_ink_in_bbox = (mask[y:y+h, x:x+w] > 0).sum()
        density = contour_ink_in_bbox / bbox_area

        # Only contours that LOOK like an anchor (square + filled)
        # are candidates or disqualifiers. Decorative content
        # (animal pictures, illustrations) inside the marker is
        # neither square nor solid-filled, so it's ignored.
        looks_like_anchor = (
            density >= 0.85 and aspect <= 1.25
        )
        if not looks_like_anchor:
            continue

        # Now we have a square filled blob. Decide if it's a valid
        # anchor (right size, in corner, clear of frame) or a
        # disqualifying one (wrong size or position).
        if rs > SIZE_MAX:
            # Filled square that's too big → wrong marker
            disqualifying_blobs += 1
            continue
        if rs < SIZE_MIN:
            continue  # too small — noise speck

        cx, cy = x + w / 2, y + h / 2
        in_left = cx < CORNER_ZONE
        in_right = cx > N - CORNER_ZONE
        in_top = cy < CORNER_ZONE
        in_bottom = cy > N - CORNER_ZONE
        if not ((in_left or in_right) and (in_top or in_bottom)):
            disqualifying_blobs += 1
            continue

        if (x < FRAME_CLEAR or y < FRAME_CLEAR
                or x + w > N - FRAME_CLEAR
                or y + h > N - FRAME_CLEAR):
            disqualifying_blobs += 1
            continue

        anchor_candidates.append({
            'cx': cx, 'cy': cy, 'side': side,
            'in_top': in_top, 'in_bottom': in_bottom,
            'in_left': in_left, 'in_right': in_right,
        })

    # Must have exactly one valid anchor and zero disqualifying blobs.
    if len(anchor_candidates) != 1 or disqualifying_blobs > 0:
        return None

    a = anchor_candidates[0]
    if a['in_top'] and a['in_left']: rot = 0
    elif a['in_top'] and a['in_right']: rot = 1
    elif a['in_bottom'] and a['in_right']: rot = 2
    else: rot = 3

    score = 1 - abs(a['side'] / N - 20 / 140) * 4
    return rot, score


def detect(image_path, save_debug=None):
    img = cv2.imread(image_path)
    if img is None:
        return None, "could not load"
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    bin_img = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 21, 10,
    )
    contours, _ = cv2.findContours(bin_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None
    best_score = -float('inf')
    best_rot = None

    for c in contours:
        if cv2.contourArea(c) < MIN_MARKER_PIXEL_SIZE ** 2:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, POLY_APPROX_EPSILON * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue

        ordered = order_corners(approx)
        if not squareness_ok(ordered):
            continue

        dst = np.array(
            [[0, 0], [OUTPUT_SIZE-1, 0], [OUTPUT_SIZE-1, OUTPUT_SIZE-1], [0, OUTPUT_SIZE-1]],
            dtype=np.float32,
        )
        M = cv2.getPerspectiveTransform(ordered, dst)
        warped = cv2.warpPerspective(img, M, (OUTPUT_SIZE, OUTPUT_SIZE))
        wgray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

        result = validate_warped(wgray)
        if result is None:
            continue
        rot, score = result

        if score > best_score:
            best_score = score
            best_rot = rot
            best = warped

    if best is None:
        return None, "no marker"

    # Apply rotation correction
    if best_rot == 1:
        best = cv2.rotate(best, cv2.ROTATE_90_CLOCKWISE)
    elif best_rot == 2:
        best = cv2.rotate(best, cv2.ROTATE_180)
    elif best_rot == 3:
        best = cv2.rotate(best, cv2.ROTATE_90_COUNTERCLOCKWISE)

    if save_debug:
        cv2.imwrite(save_debug, best)
    return best, f"detected (score={best_score:.2f}, rot={best_rot})"


if __name__ == '__main__':
    base = "/home/claude/markers/Alemeno Frontend Assignment Marker Images/Marker1-TestImages"
    out_dir = "/home/claude/prototype_output"
    os.makedirs(out_dir, exist_ok=True)

    tests = [
        ("Correct Marker Images/Marker1-TestImage1-Correct.jpg", True),
        ("Correct Marker Images/Marker1-TestImage2-Correct.jpg", True),
        ("Correct Marker Images/Marker1-TestImage3-Correct.jpg", True),
        ("Incorrect Marker Images/Marker1-TestImage4-Incorrect.jpg", False),
        ("Incorrect Marker Images/Marker1-TestImage5-Incorrect.jpg", False),
        ("Incorrect Marker Images/Marker1-TestImage6-Incorrect.jpg", False),
        ("Incorrect Marker Images/Marker1-TestImage7-Incorrect.jpg", False),
    ]

    print(f"{'Test':<55} {'Expected':<10} {'Got':<10} {'Result':<10}")
    print("-" * 100)
    passes = 0
    for rel, should_detect in tests:
        full = os.path.join(base, rel)
        out_path = os.path.join(out_dir, os.path.basename(rel).replace(".jpg", "_out.png"))
        result, msg = detect(full, save_debug=out_path if should_detect else None)
        detected = result is not None
        ok = detected == should_detect
        if ok: passes += 1
        status = "✓" if ok else "✗ FAIL"
        exp = "ACCEPT" if should_detect else "REJECT"
        got = "ACCEPT" if detected else "REJECT"
        name = os.path.basename(rel)
        print(f"{name:<55} {exp:<10} {got:<10} {status}   ({msg})")

    print(f"\n{passes}/{len(tests)} tests passed")
    sys.exit(0 if passes == len(tests) else 1)
