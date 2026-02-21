/**
 * eventProcessor.js
 *
 * Groups pending sound event packets from multiple devices that fall within
 * the same time window and triggers TDOA localization when all devices
 * have reported.
 */

const { DEVICES, EVENT_WINDOW_MS, MIN_DEVICES_FOR_LOCALIZATION } = require('./config');
const store = require('./store');
const { localize } = require('./localization/tdoa');
const broadcast = require('./broadcast');

/**
 * Attempts to find a group of packets (one per device) that are within
 * EVENT_WINDOW_MS of each other, then localizes the sound source.
 *
 * Returns the resolved event, or null if no complete group was found.
 */
function tryResolveEvent() {
  const packets = store.getPendingPackets();
  const deviceIds = Object.keys(DEVICES);

  // Build a map of deviceId -> list of pending packets for that device.
  const byDevice = {};
  deviceIds.forEach(id => { byDevice[id] = []; });
  packets.forEach(p => {
    if (byDevice[p.deviceId]) byDevice[p.deviceId].push(p);
  });

  // Check if all required devices have at least one packet.
  const hasAll = deviceIds.every(id => byDevice[id].length > 0);
  if (!hasAll) return null;

  // Try combinations: pick one packet per device and check if all timestamps
  // are within EVENT_WINDOW_MS of each other.
  function* combinations(devices, index, current) {
    if (index === devices.length) { yield [...current]; return; }
    for (const pkt of byDevice[devices[index]]) {
      current.push(pkt);
      yield* combinations(devices, index + 1, current);
      current.pop();
    }
  }

  for (const group of combinations(deviceIds, 0, [])) {
    const timestamps = group.map(p => p.adjustedTimestamp);
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);
    if (maxT - minT <= EVENT_WINDOW_MS) {
      // Found a valid group — localize and remove from pending.
      const receivers = group.map(p => ({
        deviceId: p.deviceId,
        x: DEVICES[p.deviceId].x,
        y: DEVICES[p.deviceId].y,
        timestamp: p.adjustedTimestamp,
        loudnessDb: p.loudnessDb,
      }));

      const position = localize(receivers);
      const event = store.addSoundEvent({
        position,
        devices: receivers.map(r => ({
          deviceId: r.deviceId,
          adjustedTimestamp: r.timestamp,
          loudnessDb: r.loudnessDb,
        })),
        timespanMs: parseFloat((maxT - minT).toFixed(3)),
      });

      store.removePendingPackets(group);
      broadcast.broadcastEvent(event);
      return event;
    }
  }

  // Evict packets that are too old to ever form a group.
  const now = Date.now();
  const stale = packets.filter(p => now - p.receivedAt > EVENT_WINDOW_MS * 10);
  if (stale.length > 0) {
    store.removePendingPackets(stale);
    console.log(`[eventProcessor] Evicted ${stale.length} stale packet(s).`);
  }

  return null;
}

module.exports = { tryResolveEvent };
