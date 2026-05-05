/**
 * Marker 1 Geometry Constants
 * --------------------------------------------------------------------
 * Based on the official measurements (Marker1-Measurements.jpg):
 *
 *   - Outer marker: 140 x 140 units (square)
 *   - Inner anchor square: 20 x 20 units, located in the top-left
 *     corner of the inner white area (positioned 20 units from
 *     the inner border)
 *
 * The OUTPUT_SIZE is the canvas we warp the detected marker into
 * (assignment requires exactly 300x300 px).
 *
 * All ratio constants below are RELATIVE to the marker side length,
 * so they remain valid regardless of how large the marker appears
 * in the camera frame.
 */
export const MARKER_OUTPUT_SIZE = 300;

// Marker coordinate system: 0..140
export const MARKER_UNIT_SIZE = 140;
export const ANCHOR_UNIT_SIZE = 20;

// The anchor square's expected size as a fraction of the marker side.
// From the spec: 20 / 140 ≈ 0.1428
export const ANCHOR_SIZE_RATIO = ANCHOR_UNIT_SIZE / MARKER_UNIT_SIZE;

// Tolerance bands for what counts as "the right size" anchor.
// Slightly generous to account for camera blur, perspective and
// printing variance, but tight enough to reject the "too big"
// incorrect samples (which are roughly 2x the correct size).
export const ANCHOR_SIZE_MIN_RATIO = 0.09; // ~12.6 px on 140-side
export const ANCHOR_SIZE_MAX_RATIO = 0.21; // ~29.4 px on 140-side

// The anchor must live in a corner region, NOT in the center.
// We define a corner region as the OUTER 40% of the marker side
// from any corner. This rejects the "centered anchor" incorrect
// samples while accepting all 4 corner positions (the marker is
// square, so any corner is acceptable - we'll rotate to canonical
// orientation later).
export const CORNER_ZONE_RATIO = 0.40;

// The black outer frame of the marker is approximately 10/140 ≈ 7%
// thick on each side. We use this to verify the candidate is a
// hollow square frame, not a solid filled square.
export const FRAME_THICKNESS_RATIO_MIN = 0.04;
export const FRAME_THICKNESS_RATIO_MAX = 0.12;

// Minimum marker side length (in pixels of the analyzed frame) to
// even consider a contour. Markers smaller than this won't decode
// reliably.
export const MIN_MARKER_PIXEL_SIZE = 60;

// When testing whether a candidate's outer contour is "square enough",
// the ratio of (longer side) / (shorter side) of its minAreaRect
// must be below this threshold. 1.0 is a perfect square.
// Allow up to ~2.5x aspect ratio so that markers seen at significant
// perspective angle (e.g., camera held at 30° off-axis to the marker)
// still pass. The perspective warp downstream restores the square,
// so a generous tolerance here only affects which candidates we
// consider — not the final extracted marker quality.
export const SQUARENESS_TOLERANCE = 2.5;

// Polygon approximation epsilon as a fraction of perimeter.
// Standard value for finding 4-corner shapes.
export const POLY_APPROX_EPSILON = 0.04;
