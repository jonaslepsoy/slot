/**
 * routes/mode.js
 *
 * GET  /mode          — Get the current server mode.
 * POST /mode          — Set the server mode.
 *                       Body: { mode: "sync" | "localize" }
 *
 * Switching to "sync" clears the sync buffer so a fresh sync session begins.
 * Switching to "localize" also clears the sync buffer (cancels any in-progress sync).
 */

const express = require('express');
const router = express.Router();
const store = require('../store');

const VALID_MODES = ['sync', 'localize'];

router.get('/', (req, res) => {
  res.json({
    mode: store.getMode(),
    offsets: store.getAllOffsets(),
    isSynced: Object.keys(require('../config').DEVICES).every(
      id => store.getAllOffsets()[id] !== undefined
    ),
  });
});

router.post('/', (req, res) => {
  const { mode } = req.body;
  if (!mode || !VALID_MODES.includes(mode)) {
    return res.status(400).json({
      error: `Invalid mode "${mode}". Valid modes: ${VALID_MODES.join(', ')}`,
    });
  }

  store.setMode(mode);
  store.clearSyncBuffer();

  if (mode === 'sync') {
    store.clearOffsets();
    console.log('[mode] Switched to sync mode. Previous offsets cleared.');
  } else {
    console.log('[mode] Switched to localize mode.');
  }

  res.json({ mode, message: `Server is now in ${mode} mode.` });
});

module.exports = router;
