/**
 * routes/packet.js
 *
 * POST /packet
 * The single endpoint all phones send data to.
 * Body: Array of samples from one device:
 *   [{ deviceId: string, timestamp: number (ms), loudnessDb: number }, ...]
 *
 * The server extracts the exact clap timestamp from the clump using onset
 * detection (largest loudness jump → clap onset) and then proceeds as before.
 *
 * Behaviour depends on the current server mode (store.getMode()):
 *
 *  'sync'     — Detected onset timestamp is recorded as the sync pulse.
 *               Once all devices have reported, clock offsets are calculated
 *               and the server automatically switches back to 'localize' mode.
 *
 *  'localize' — Onset timestamp is corrected using the stored clock offset,
 *               packet is added to the pending buffer, and localization
 *               is attempted when all devices have reported.
 */

const express = require('express');
const router = express.Router();
const { DEVICES, SYNC_WINDOW_MS, SYNC_ROUNDS } = require('../config');
const store = require('../store');
const { tryResolveEvent } = require('../eventProcessor');
const cli = require('../cli');
const { detectClapOnset } = require('../soundDetection');

/**
 * Convert a raw amplitude value to decibels (dB).
 * Uses 20·log10(amplitude), with a floor of 0 dB for values ≤ 1.
 */
function toDb(amplitude) {
  if (amplitude <= 1) return 0;
  return parseFloat((20 * Math.log10(amplitude)).toFixed(1));
}

/**
 * Compute the median offset for each device across all sync rounds.
 * The median is more robust to outliers than the mean.
 */
function computeMedianOffsets(rounds, deviceIds) {
  const result = {};
  for (const id of deviceIds) {
    const values = rounds.map(r => r.offsets[id]).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    result[id] = values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  }
  return result;
}

/**
 * Compute standard deviation of per-round offsets for each device.
 * High stddev means noisy sync — offsets unreliable.
 */
function computeOffsetStdDevs(rounds, deviceIds) {
  const result = {};
  for (const id of deviceIds) {
    const values = rounds.map(r => r.offsets[id]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    result[id] = parseFloat(Math.sqrt(variance).toFixed(3));
  }
  return result;
}

/**
 * Validate the incoming samples array.
 * Returns the validated samples array, or null (and sends error response).
 */
function validateSamples(req, res) {
  const samples = req.body;

  if (!Array.isArray(samples) || samples.length === 0) {
    res.status(400).json({ error: 'Body must be a non-empty array of { deviceId, timestamp, loudnessDb } samples.' });
    return null;
  }

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s.deviceId || s.timestamp === undefined || s.loudnessDb === undefined) {
      res.status(400).json({ error: `Sample[${i}] is missing deviceId, timestamp, or loudnessDb.` });
      return null;
    }
    if (typeof s.timestamp !== 'number' || typeof s.loudnessDb !== 'number') {
      res.status(400).json({ error: `Sample[${i}]: timestamp and loudnessDb must be numbers.` });
      return null;
    }
    if (!DEVICES[s.deviceId]) {
      res.status(400).json({ error: `Sample[${i}]: unknown deviceId "${s.deviceId}". Known: ${Object.keys(DEVICES).join(', ')}` });
      return null;
    }
  }

  // All samples must belong to the same device.
  const deviceIds = [...new Set(samples.map(s => s.deviceId))];
  if (deviceIds.length > 1) {
    res.status(400).json({ error: `All samples in one packet must share the same deviceId. Found: ${deviceIds.join(', ')}` });
    return null;
  }

  return samples;
}

function loudnessLabel(db) {
  return typeof db === 'number' ? db.toFixed(0) : db;
}

router.post('/', (req, res) => {
  const samples = validateSamples(req, res);
  if (!samples) return;

  const deviceId = samples[0].deviceId;
  const mode = store.getMode();

  // ── Sync mode ──────────────────────────────────────────────────────────────
  if (mode === 'sync') {
    const onset = detectClapOnset(samples);

    if (!onset) {
      // console.log(`[sync] ${deviceId}: no clap detected (${samples.length} samples, below threshold)`);
      return res.json({
        mode: 'sync',
        status: 'no_clap',
        message: `No clap detected from ${deviceId}. Still listening…`,
      });
    }

    // console.log(`[sync] ${deviceId}: clap onset at ${onset.timestamp} ms (${toDb(onset.loudnessDb)} dB) from ${samples.length} samples`);

    // Discard stale partial sync data if the first clap arrived too long ago.
    const syncBuffer = store.getSyncBuffer();
    const existingEntries = Object.values(syncBuffer);
    if (existingEntries.length > 0) {
      const oldestReceivedAt = Math.min(...existingEntries.map(e => e.receivedAt));
      if (Date.now() - oldestReceivedAt > SYNC_WINDOW_MS) {
        console.log(`[sync] Partial sync data expired (>${SYNC_WINDOW_MS} ms). Discarding and starting fresh.`);
        store.clearSyncBuffer();
      }
    }

    // Clear previous offsets on the very first packet of a brand-new sync session
    // (no rounds collected yet and sync buffer was empty before this packet).
    if (store.getSyncRounds().length === 0 && existingEntries.length === 0) {
      store.clearOffsets();
      console.log('[sync] New sync session started — previous offsets cleared.');
    }

    store.setSyncPacket(deviceId, onset.timestamp);

    const deviceIds = Object.keys(DEVICES);
    const syncBufferAfter = store.getSyncBuffer();
    const reported = deviceIds.filter(id => syncBufferAfter[id] !== undefined);
    const waiting = deviceIds.filter(id => syncBufferAfter[id] === undefined);

    if (waiting.length === 0) {
      // This round is complete — calculate per-round offsets.
      const minTs = Math.min(...deviceIds.map(id => syncBufferAfter[id].timestamp));
      const roundOffsets = {};
      deviceIds.forEach(id => { roundOffsets[id] = minTs - syncBufferAfter[id].timestamp; });
      store.addSyncRound({ offsets: roundOffsets });
      store.clearSyncBuffer();

      const rounds = store.getSyncRounds();
      const roundNum = rounds.length;

      // Notify the CLI.
      cli.onSyncRoundComplete(roundNum, SYNC_ROUNDS, roundOffsets);

      if (roundNum < SYNC_ROUNDS) {
        // Need more rounds — keep listening.
        return res.json({
          mode: 'sync',
          status: 'round_complete',
          round: roundNum,
          targetRounds: SYNC_ROUNDS,
          roundOffsets,
          message: `Round ${roundNum}/${SYNC_ROUNDS} complete. Keep clapping! ${SYNC_ROUNDS - roundNum} more round(s) needed.`,
        });
      }

      // All rounds collected — compute final offsets using median.
      const finalOffsets = computeMedianOffsets(rounds, deviceIds);
      const stdDevs = computeOffsetStdDevs(rounds, deviceIds);
      deviceIds.forEach(id => store.setClockOffset(id, finalOffsets[id]));
      store.clearSyncRounds();
      store.setMode('localize');

      console.log(`[sync] ${roundNum} rounds complete. Final median offsets (ms):`, finalOffsets);
      console.log(`[sync] Offset std deviations (ms):`, stdDevs);
      const maxStdDev = Math.max(...Object.values(stdDevs));
      if (maxStdDev > 5) {
        console.log(`[sync] ⚠ WARNING: high offset variance (${maxStdDev.toFixed(1)}ms) — consider re-syncing with more claps or sharper sounds.`);
      }
      console.log('[mode] Switched to localize mode.');

      return res.json({
        mode: 'sync',
        status: 'complete',
        message: `Sync complete (${roundNum} rounds averaged). Server switched to localize mode.`,
        offsets: finalOffsets,
        stdDevs,
        rounds: roundNum,
      });
    }

    // Notify the CLI about individual packet progress.
    cli.onSyncPacketReceived(deviceId, onset.timestamp);

    return res.json({
      mode: 'sync',
      status: 'waiting',
      reported,
      waiting,
      round: store.getSyncRounds().length + 1,
      targetRounds: SYNC_ROUNDS,
      message: `Round ${store.getSyncRounds().length + 1}/${SYNC_ROUNDS}: waiting for ${waiting.length} more device(s): ${waiting.join(', ')}`,
    });
  }

  // ── Localize mode ──────────────────────────────────────────────────────────
  const onset = detectClapOnset(samples);

  if (!onset) {
    return res.json({
      mode: 'localize',
      status: 'no_clap',
      message: `No clap detected from ${deviceId}. Ignoring packet.`,
    });
  }

  const { timestamp, loudnessDb } = onset;
  const offset = store.getClockOffset(deviceId);
  const adjustedTimestamp = timestamp + offset;

  store.addPendingPacket({
    deviceId,
    timestamp,
    adjustedTimestamp,
    loudnessDb: toDb(loudnessDb),
    receivedAt: Date.now(),
  });

  //console.log(`[localize] ${deviceId}: raw=${timestamp} ms, offset=${offset} ms, adjusted=${adjustedTimestamp} ms`);

  const event = tryResolveEvent();

  if (event) {
    if (event.position) {
      console.log(`[localize] Event #${event.id} → (${event.position.x}, ${event.position.y}) m`);
      return res.json({ mode: 'localize', status: 'localized', event });
    } else {
      console.log(`[localize] Event #${event.id} → REJECTED (TDOA outside physical limits)`);
      return res.json({ mode: 'localize', status: 'rejected', message: 'TDOA values exceed room geometry — timestamps too noisy.', event });
    }
  }

  const pending = store.getPendingPackets();
  const reportedDevices = [...new Set(pending.map(p => p.deviceId))];
  const waitingFor = Object.keys(DEVICES).filter(id => !reportedDevices.includes(id));

  res.json({
    mode: 'localize',
    status: 'pending',
    message: `Packet received. Waiting for ${waitingFor.length} more device(s): ${waitingFor.join(', ')}`,
    reportedDevices,
    waitingFor,
  });
});

module.exports = router;
