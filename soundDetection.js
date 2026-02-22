const { CLAP_THRESHOLD } = require("./config");

/**
 * soundDetection.js
 *
 * Detects the exact onset timestamp of a sharp clap from an array of loudness
 * samples sent by a phone.
 *
 * Signal shape:
 *   ─── background (low, roughly flat) ───▶ CLAP ▶── echo fade (high, decreasing) ──
 *
 * Strategy:
 *   1. Find the biggest single-step loudness increase → identifies the clap region.
 *   2. Walk backward from that point to locate the first sample still BELOW
 *      CLAP_THRESHOLD.  This is the true pre-onset sample.
 *   3. Linearly interpolate between the below-threshold sample and the next one
 *      (which is ≥ threshold) to estimate sub-sample crossing time.
 *
 * Why walk backward?  A close phone may already be above threshold one or more
 * samples before the biggest jump.  Using the biggest-jump pair directly would
 * clamp fraction to 0 and systematically bias the timestamp late — corrupting
 * TDOA because the bias differs per phone depending on distance.
 *
 * @param {Array<{ deviceId: string, timestamp: number, loudnessDb: number }>} samples
 * @returns {{ deviceId: string, timestamp: number, loudnessDb: number } | null}
 *   The detected onset with an interpolated timestamp, or null.
 */
function detectClapOnset(samples) {
  if (!samples || samples.length === 0) return null;
  if (samples.length === 1) return samples[0];

  // Work on a timestamp-sorted copy so packets can arrive in any order.
  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);

  // Step 1: Find the biggest positive jump → clap region.
  let bestJump = -Infinity;
  let onsetIdx = 0;

  for (let i = 1; i < sorted.length; i++) {
    const jump = sorted[i].loudnessDb - sorted[i - 1].loudnessDb;
    if (jump > bestJump) {
      bestJump = jump;
      onsetIdx = i;
    }
  }

  if (sorted[onsetIdx].loudnessDb < CLAP_THRESHOLD) {
    return null;
  }

  // Step 2: Walk backward from the biggest-jump point to find the first
  //         sample that is below threshold.  The threshold crossing lies
  //         between that sample and the one after it.
  let crossingIdx = onsetIdx; // index of the first sample ≥ threshold in the pair
  for (let i = onsetIdx; i >= 1; i--) {
    if (sorted[i - 1].loudnessDb < CLAP_THRESHOLD) {
      crossingIdx = i;
      break;
    }
    if (i === 1) {
      // All samples from the start are above threshold — can't interpolate.
      crossingIdx = 0;
    }
  }

  // If we couldn't find a below-threshold sample, return the earliest
  // above-threshold sample as-is (no interpolation possible).
  if (crossingIdx === 0) {
    console.log(
      `[onset] ${sorted[0].deviceId}: all samples ≥ threshold — using earliest sample ts=${sorted[0].timestamp}`
    );
    return sorted[0];
  }

  // Step 3: Interpolate between the below-threshold and above-threshold sample.
  const below = sorted[crossingIdx - 1];
  const above = sorted[crossingIdx];
  const range = above.loudnessDb - below.loudnessDb;

  let fraction;
  if (range > 0) {
    fraction = (CLAP_THRESHOLD - below.loudnessDb) / range;
    // Clamp to [0, 1] for safety (should naturally be in-range).
    fraction = Math.max(0, Math.min(1, fraction));
  } else {
    fraction = 0.5;
  }

  const dt = above.timestamp - below.timestamp;
  const interpolatedTimestamp = below.timestamp + fraction * dt;

  if (dt === 0) {
    console.log(
      `[onset] ${above.deviceId}: WARNING identical timestamps (${above.timestamp}) ` +
      `on crossing pair — interpolation ineffective`
    );
  } else {
    const walkBack = onsetIdx - crossingIdx;
    const walkInfo = walkBack > 0 ? ` (walked back ${walkBack} sample${walkBack > 1 ? 's' : ''})` : '';
    console.log(
      `[onset] ${above.deviceId}: below=${below.loudnessDb} above=${above.loudnessDb} ` +
      `threshold=${CLAP_THRESHOLD} → fraction=${fraction.toFixed(4)} ` +
      `ts=${below.timestamp}..${above.timestamp} (dt=${dt}ms) → ${interpolatedTimestamp.toFixed(2)}${walkInfo}`
    );
  }

  return {
    deviceId: above.deviceId,
    timestamp: interpolatedTimestamp,
    loudnessDb: sorted[onsetIdx].loudnessDb, // peak loudness from original biggest jump
  };
}

module.exports = { detectClapOnset };
