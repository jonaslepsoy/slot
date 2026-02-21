/**
 * routes/results.js
 *
 * GET /results
 * Returns recent sound localization events.
 *
 * GET /results/latest
 * Returns the most recent sound localization event.
 *
 * GET /status
 * Returns overall server status, device config, and pending packets.
 */

const express = require('express');
const router = express.Router();
const { DEVICES, EVENT_WINDOW_MS, SPEED_OF_SOUND } = require('../config');
const store = require('../store');
const broadcast = require('../broadcast');

router.get('/results', (req, res) => {
  const events = store.getSoundEvents();
  res.json({ count: events.length, events });
});

router.get('/results/latest', (req, res) => {
  const events = store.getSoundEvents();
  if (events.length === 0) return res.json({ event: null });
  res.json({ event: events[events.length - 1] });
});

router.get('/status', (req, res) => {
  const pending = store.getPendingPackets();
  const offsets = store.getAllOffsets();
  const events = store.getSoundEvents();

  res.json({
    mode: store.getMode(),
    config: {
      devices: DEVICES,
      eventWindowMs: EVENT_WINDOW_MS,
      speedOfSound: SPEED_OF_SOUND,
    },
    sync: {
      offsets,
      isSynced: Object.keys(DEVICES).every(id => offsets[id] !== undefined),
    },
    pendingPackets: pending.length,
    totalEvents: events.length,
    wsClients: broadcast.clientCount(),
  });
});

module.exports = router;
