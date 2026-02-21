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
const { DEVICES } = require('../config');
const store = require('../store');
const { tryResolveEvent } = require('../eventProcessor');
const cli = require('../cli');
const { detectClapOnset } = require('../soundDetection');

/**
 * Validate the incoming samples array and return the detected onset sample,
 * or send an error response and return null.
 */
function validateAndDetect(req, res) {
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

  const onset = detectClapOnset(samples);
  console.log(`[detect] ${onset.deviceId}: clap onset at ${onset.timestamp} ms (${loudnessLabel(onset.loudnessDb)} dB) from ${samples.length} samples`);
  return onset;
}

function loudnessLabel(db) {
  return typeof db === 'number' ? db.toFixed(0) : db;
}

router.post('/', (req, res) => {
  const onset = validateAndDetect(req, res);
  if (!onset) return;

  const { deviceId, timestamp, loudnessDb } = onset;
  const mode = store.getMode();

  // ── Sync mode ──────────────────────────────────────────────────────────────
  if (mode === 'sync') {
    store.setSyncPacket(deviceId, timestamp);
    console.log(`[sync] ${deviceId}: timestamp=${timestamp} ms`);

    // Notify the CLI (so it can print live progress in sync mode).
    cli.onSyncPacketReceived(deviceId, timestamp);

    const deviceIds = Object.keys(DEVICES);
    const syncBuffer = store.getSyncBuffer();
    const reported = deviceIds.filter(id => syncBuffer[id] !== undefined);
    const waiting = deviceIds.filter(id => syncBuffer[id] === undefined);

    if (waiting.length === 0) {
      // All devices reported — calculate offsets and switch back to localize.
      const minTs = Math.min(...deviceIds.map(id => syncBuffer[id]));
      deviceIds.forEach(id => store.setClockOffset(id, minTs - syncBuffer[id]));
      store.clearSyncBuffer();
      store.setMode('localize');

      const offsets = store.getAllOffsets();
      console.log('[sync] All devices synced. Offsets (ms):', offsets);
      console.log('[mode] Switched to localize mode.');

      return res.json({
        mode: 'sync',
        status: 'complete',
        message: 'All devices synced. Server switched to localize mode.',
        offsets,
      });
    }

    return res.json({
      mode: 'sync',
      status: 'waiting',
      reported,
      waiting,
      message: `Waiting for ${waiting.length} more device(s): ${waiting.join(', ')}`,
    });
  }

  // ── Localize mode ──────────────────────────────────────────────────────────
  const offset = store.getClockOffset(deviceId);
  const adjustedTimestamp = timestamp + offset;

  store.addPendingPacket({
    deviceId,
    timestamp,
    adjustedTimestamp,
    loudnessDb,
    receivedAt: Date.now(),
  });

  console.log(`[localize] ${deviceId}: raw=${timestamp.toFixed(3)} ms, offset=${offset} ms, adjusted=${adjustedTimestamp.toFixed(3)} ms, ${loudnessDb} dB`);

  const event = tryResolveEvent();

  if (event) {
    console.log(`[localize] Event #${event.id} → (${event.position.x}, ${event.position.y}) m`);
    return res.json({ mode: 'localize', status: 'localized', event });
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
