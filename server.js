/**
 * server.js
 * 
 * Sound Localization Server
 * 
 * Receives sound event packets from three client phones and calculates
 * the (x, y) position of the sound source using Time Difference of Arrival (TDOA).
 * 
 * HTTP Endpoints:
 *  POST   /packet             - Receive a data packet from a phone (all modes).
 *
 *  GET    /mode               - Get the current server mode.
 *  POST   /mode               - Set the server mode { mode: 'sync'|'localize' }.
 *
 *  GET    /results            - List all localized sound events.
 *  GET    /results/latest     - Latest localized sound event.
 *  GET    /status             - Server status.
 *
 * WebSocket:
 *  ws://<host>:<port>         - Receives { type: 'sound_event', event } messages
 *                               whenever a sound is localized.
 */

const http = require('http');
const express = require('express');
const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
const packetRouter = require('./routes/packet');
const modeRouter = require('./routes/mode');
const resultsRouter = require('./routes/results');
const cli = require('./cli');
const broadcast = require('./broadcast');
broadcast.init(httpServer);

app.use('/packet', packetRouter);
app.use('/mode', modeRouter);
app.use(resultsRouter);          // mounts /results, /results/latest, /status

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'Sound Localization Server',
    version: '1.0.0',
    endpoints: {
      packet: {
        'POST /packet': 'Receive data from a phone [{ deviceId, timestamp, loudnessDb }, ...]',
      },
      mode: {
        'GET /mode': 'Get current server mode',
        'POST /mode': 'Set server mode { mode: "sync"|"localize" }',
      },
      results: {
        'GET /results': 'All localized sound events',
        'GET /results/latest': 'Most recent localized event',
        'GET /status': 'Server status (includes current mode)',
      },
      websocket: {
        'ws://<host>:<port>': 'Real-time localization events: { type: "sound_event", event: { id, timestamp, position: {x,y}, devices, timespanMs } }',
      },
    },
  });
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error.', details: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const { DEVICES, SPEED_OF_SOUND, EVENT_WINDOW_MS } = require('./config');

  // Find all non-internal IPv4 addresses so the user knows what to point phones at.
  const networkIPs = Object.values(os.networkInterfaces())
    .flat()
    .filter(iface => iface.family === 'IPv4' && !iface.internal)
    .map(iface => iface.address);

  console.log(`\nSound Localization Server listening on 0.0.0.0:${PORT}`);
  console.log(`Speed of sound: ${SPEED_OF_SOUND} m/s`);
  console.log(`Event window: ${EVENT_WINDOW_MS} ms`);
  console.log('\nDevice positions:');
  Object.entries(DEVICES).forEach(([id, pos]) => {
    console.log(`  ${id}: (${pos.x}, ${pos.y}) m`);
  });
  console.log('\nReachable at:');
  console.log(`  http://localhost:${PORT}/  (this machine)`);
  networkIPs.forEach(ip => console.log(`  http://${ip}:${PORT}/  (phones on same network)`));
  console.log('\nPacket endpoint for phones:');
  networkIPs.forEach(ip => console.log(`  POST http://${ip}:${PORT}/packet`));
  console.log('\nWebSocket endpoint for frontend:');
  console.log(`  ws://localhost:${PORT}  (this machine)`);
  networkIPs.forEach(ip => console.log(`  ws://${ip}:${PORT}  (on the network)`));
  console.log('');
  cli.start();
});
