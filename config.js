/**
 * config.js
 *
 * Room and device configuration.
 *
 * Coordinate system (origin at room center):
 *
 *           y = +3.5  ←  back  (curved wall)
 *
 *     x = -5 ────────── 0 ────────── x = +5
 *
 *           y = -3.5  ←  front (stage)
 *
 * Room: 10 m wide (x), 7 m deep (y).
 * Phones should be spread as far apart as possible for best TDOA accuracy.
 */

const SPEED_OF_SOUND = 343; // m/s at ~20°C

// Device positions in the room (meters).
// Update these to match the actual placement of the phones.
const DEVICES = {
  'phone-a': { x: -5.0, y: -3.0 },  // front-left
  'phone-b': { x:  5.0, y: -3.0 },  // front-right
  'phone-c': { x:  0.0, y:  3.5 },  // back-center (curved wall)
};

// Maximum time window (ms) in which packets from all devices
// must arrive to be grouped as the same sound event.
const EVENT_WINDOW_MS = 200;

const CLAP_THRESHOLD = 10000; // Minimum loudness to register a clapOnset

// Maximum time (ms) to wait for all phones to report a sync clap.
// If the first phone's clap is older than this when a new one arrives,
// the partial sync data is discarded and a fresh sync round begins.
const SYNC_WINDOW_MS = 5000;

// Number of sync clap rounds to collect before calculating final offsets.
// More rounds → better accuracy (error scales as 1/√N).
// With 10 rounds at ~36ms sample intervals, expected timing error ≈ ±3–5ms.
const SYNC_ROUNDS = 10;

// Minimum number of devices required to attempt localization.
const MIN_DEVICES_FOR_LOCALIZATION = 3;

module.exports = { SPEED_OF_SOUND, DEVICES, EVENT_WINDOW_MS, MIN_DEVICES_FOR_LOCALIZATION, CLAP_THRESHOLD, SYNC_WINDOW_MS, SYNC_ROUNDS };
