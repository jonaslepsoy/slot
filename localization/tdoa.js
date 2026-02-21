/**
 * localization/tdoa.js
 *
 * 2D sound source localization using Time Difference of Arrival (TDOA).
 *
 * Given 3 receivers at known positions and their sound arrival timestamps,
 * finds the (x, y) position of the sound source using the Gauss-Newton
 * iterative least-squares method.
 *
 * Assumes:
 *  - All timestamps are in milliseconds, already corrected for clock offsets.
 *  - Receiver positions are in meters.
 *  - Speed of sound is 343 m/s.
 */

const { SPEED_OF_SOUND } = require('../config');

/**
 * Euclidean distance between two 2D points.
 */
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/**
 * Localize a sound source using TDOA.
 *
 * @param {Array} receivers - Array of { deviceId, x, y, timestamp } objects (at least 3).
 * @returns {{ x: number, y: number, residual: number } | null}
 */
function localize(receivers) {
  if (receivers.length < 3) return null;

  // Use the first receiver as the reference.
  const [r0, r1, r2] = receivers;

  // TDOA values in seconds (adjusted timestamps are in ms -> convert to s).
  const tdoa10 = (r1.timestamp - r0.timestamp) / 1000; // t1 - t0
  const tdoa20 = (r2.timestamp - r0.timestamp) / 1000; // t2 - t0

  // Range differences in meters.
  const rd10 = tdoa10 * SPEED_OF_SOUND; // d1 - d0
  const rd20 = tdoa20 * SPEED_OF_SOUND; // d2 - d0

  // Initial estimate: centroid of all receiver positions.
  let x = (r0.x + r1.x + r2.x) / 3;
  let y = (r0.y + r1.y + r2.y) / 3;

  const MAX_ITERATIONS = 200;
  const TOLERANCE = 1e-9;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const d0 = dist(x, y, r0.x, r0.y) || 1e-9;
    const d1 = dist(x, y, r1.x, r1.y) || 1e-9;
    const d2 = dist(x, y, r2.x, r2.y) || 1e-9;

    // Residuals: f_i = (d_i - d_0)/c - TDOA_i0   (should be 0 at source)
    const f1 = (d1 - d0) / SPEED_OF_SOUND - tdoa10;
    const f2 = (d2 - d0) / SPEED_OF_SOUND - tdoa20;

    // Jacobian rows: df_i/dx, df_i/dy
    const c = SPEED_OF_SOUND;
    const j11 = (x - r1.x) / (c * d1) - (x - r0.x) / (c * d0);
    const j12 = (y - r1.y) / (c * d1) - (y - r0.y) / (c * d0);
    const j21 = (x - r2.x) / (c * d2) - (x - r0.x) / (c * d0);
    const j22 = (y - r2.y) / (c * d2) - (y - r0.y) / (c * d0);

    // Solve 2x2 system (J^T J) delta = -J^T f using direct inversion.
    // J^T J = [[j11^2+j21^2, j11*j12+j21*j22], [j12*j11+j22*j21, j12^2+j22^2]]
    // J^T f = [j11*f1+j21*f2, j12*f1+j22*f2]
    const A11 = j11 * j11 + j21 * j21;
    const A12 = j11 * j12 + j21 * j22;
    const A21 = A12;
    const A22 = j12 * j12 + j22 * j22;
    const b1 = -(j11 * f1 + j21 * f2);
    const b2 = -(j12 * f1 + j22 * f2);

    const det = A11 * A22 - A12 * A21;
    if (Math.abs(det) < 1e-20) break; // Singular matrix, stop

    const dx = (A22 * b1 - A12 * b2) / det;
    const dy = (A11 * b2 - A21 * b1) / det;

    x += dx;
    y += dy;

    if (Math.abs(dx) < TOLERANCE && Math.abs(dy) < TOLERANCE) break;
  }

  // Final residual (RMS of TDOA errors in meters).
  const d0f = dist(x, y, r0.x, r0.y) || 1e-9;
  const d1f = dist(x, y, r1.x, r1.y) || 1e-9;
  const d2f = dist(x, y, r2.x, r2.y) || 1e-9;
  const res1 = Math.abs((d1f - d0f) - rd10 * SPEED_OF_SOUND / SPEED_OF_SOUND);
  const res2 = Math.abs((d2f - d0f) - rd20 * SPEED_OF_SOUND / SPEED_OF_SOUND);
  const residual = Math.sqrt((res1 ** 2 + res2 ** 2) / 2);

  return { x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(4)), residual: parseFloat(residual.toFixed(6)) };
}

module.exports = { localize };
