/**
 * store.js
 *
 * In-memory storage for:
 *  - Server mode: 'sync' | 'localize'
 *  - Sync buffer: temporary packets collected during sync mode
 *  - Clock offsets per device (calculated after a sync session)
 *  - Pending sound event packets (waiting for all devices to report)
 *  - Resolved sound events with calculated positions
 */

// Server operating mode.
let currentMode = 'localize'; // 'sync' | 'localize'

function getMode() { return currentMode; }
function setMode(mode) { currentMode = mode; }

// Temporary buffer for packets received during sync mode: deviceId -> { timestamp, receivedAt }
const syncBuffer = {};

function setSyncPacket(deviceId, timestamp) { syncBuffer[deviceId] = { timestamp, receivedAt: Date.now() }; }
function getSyncBuffer() { return { ...syncBuffer }; }
function clearSyncBuffer() { Object.keys(syncBuffer).forEach(k => delete syncBuffer[k]); }

// Completed sync rounds: array of { offsets: { deviceId: offsetMs }, ... }
const syncRounds = [];

function addSyncRound(round) { syncRounds.push(round); }
function getSyncRounds() { return [...syncRounds]; }
function clearSyncRounds() { syncRounds.length = 0; }

// Map of deviceId -> clock offset in milliseconds.
// offset = (reference time) - (device reported time) for the sync event.
// Applied as: adjustedTimestamp = reportedTimestamp + offset
const clockOffsets = {};

// Array of recent unresolved packets, each:
// { deviceId, timestamp (ms, adjusted), loudnessDb, receivedAt }
const pendingPackets = [];

// Array of resolved sound events, each:
// { id, timestamp, position: { x, y }, devices: [...], createdAt }
const soundEvents = [];

let eventCounter = 0;

function setClockOffset(deviceId, offsetMs) {
  clockOffsets[deviceId] = offsetMs;
}

function getClockOffset(deviceId) {
  return clockOffsets[deviceId] || 0;
}

function getAllOffsets() {
  return { ...clockOffsets };
}

function clearOffsets() {
  Object.keys(clockOffsets).forEach(k => delete clockOffsets[k]);
}

function addPendingPacket(packet) {
  pendingPackets.push(packet);
}

function getPendingPackets() {
  return pendingPackets;
}

function removePendingPackets(packets) {
  packets.forEach(p => {
    const idx = pendingPackets.indexOf(p);
    if (idx !== -1) pendingPackets.splice(idx, 1);
  });
}

function addSoundEvent(event) {
  event.id = ++eventCounter;
  event.createdAt = new Date().toISOString();
  soundEvents.push(event);
  // Keep only the last 100 events in memory
  if (soundEvents.length > 100) soundEvents.shift();
  return event;
}

function getSoundEvents() {
  return [...soundEvents];
}

module.exports = {
  getMode,
  setMode,
  setSyncPacket,
  getSyncBuffer,
  clearSyncBuffer,
  addSyncRound,
  getSyncRounds,
  clearSyncRounds,
  setClockOffset,
  getClockOffset,
  getAllOffsets,
  clearOffsets,
  addPendingPacket,
  getPendingPackets,
  removePendingPackets,
  addSoundEvent,
  getSoundEvents,
};
