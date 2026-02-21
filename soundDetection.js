/**
 * soundDetection.js
 *
 * Detects the exact onset timestamp of a sharp clap from an array of loudness
 * samples sent by a phone.
 *
 * Signal shape:
 *   ─── background (low, roughly flat) ───▶ CLAP ▶── echo fade (high, decreasing) ──
 *
 * The clap creates the largest single-step increase in loudness. We identify
 * the onset as the sample where  loudnessDb[i] − loudnessDb[i-1]  is greatest.
 *
 * @param {Array<{ deviceId: string, timestamp: number, loudnessDb: number }>} samples
 * @returns {{ deviceId: string, timestamp: number, loudnessDb: number } | null}
 *   The sample that marks the clap onset, or null when the array is empty.
 */
function detectClapOnset(samples) {
  if (!samples || samples.length === 0) return null;
  if (samples.length === 1) return samples[0];

  // Work on a timestamp-sorted copy so packets can arrive in any order.
  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);

  let bestJump = -Infinity;
  let onsetIdx = 0; // fall back to first sample if all diffs are negative

  for (let i = 1; i < sorted.length; i++) {
    const jump = sorted[i].loudnessDb - sorted[i - 1].loudnessDb;
    if (jump > bestJump) {
      bestJump = jump;
      onsetIdx = i;
    }
  }

  return sorted[onsetIdx];
}

module.exports = { detectClapOnset };
