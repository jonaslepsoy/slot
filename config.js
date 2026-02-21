/**
 * config.js
 * 
 * Room and device configuration.
 * Room is approximately 10x10 meters with origin at bottom-left corner.
 * 
 * Device positions are in meters (x, y) in the room.
 * Place devices at corners/edges of the room for best TDOA accuracy.
 */

const SPEED_OF_SOUND = 343; // m/s at ~20°C

// Device positions in the room (meters).
// These should be updated to match the actual placement of the phones.
const DEVICES = {
  'phone-a': { x: -5.0, y: 1.0 },   // bottom-left corner
  'phone-b': { x: 5.0, y: 1.0 },  // bottom-right corner
  'phone-c': { x: 0.0, y: 7.0 },  // top-center
};

// Maximum time window (ms) in which packets from all devices
// must arrive to be grouped as the same sound event.
const EVENT_WINDOW_MS = 200;

// Minimum number of devices required to attempt localization.
const MIN_DEVICES_FOR_LOCALIZATION = 3;

module.exports = { SPEED_OF_SOUND, DEVICES, EVENT_WINDOW_MS, MIN_DEVICES_FOR_LOCALIZATION };
