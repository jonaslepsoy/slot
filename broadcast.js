/**
 * broadcast.js
 *
 * WebSocket server that pushes localization events to connected frontends.
 *
 * Usage:
 *   const broadcast = require('./broadcast');
 *   broadcast.init(httpServer);          // once, at startup
 *   broadcast.broadcastEvent(event);     // called by eventProcessor
 *
 * Frontend connects to:
 *   ws://<server-ip>:<port>
 *
 * Messages sent to clients:
 *   { type: 'sound_event', event: { id, timestamp, position: {x,y}, devices, timespanMs } }
 *   { type: 'connected',   message: '...' }
 */

const { WebSocketServer, OPEN } = require('ws');

let wss = null;

/**
 * Attach the WebSocket server to an existing http.Server instance.
 * Both HTTP and WS traffic share the same port.
 */
function init(httpServer) {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const addr = req.socket.remoteAddress;
    console.log(`[ws] Client connected from ${addr}`);

    // Send a welcome message so the frontend knows the socket is live.
    ws.send(JSON.stringify({ type: 'connected', message: 'Sound Localization Server connected. Listening for events.' }));

    ws.on('close', () => console.log(`[ws] Client from ${addr} disconnected`));
    ws.on('error', err => console.error(`[ws] Error from ${addr}:`, err.message));
  });

  return wss;
}

/**
 * Broadcast a localized sound event to all connected WebSocket clients.
 * @param {object} event  The event object returned by store.addSoundEvent()
 */
function broadcastEvent(event) {
  if (!wss) return;

  const msg = JSON.stringify({ type: 'sound_event', event });
  let sent = 0;

  wss.clients.forEach(client => {
    if (client.readyState === OPEN) {
      client.send(msg);
      sent++;
    }
  });

  if (sent > 0) {
    console.log(`[ws] Broadcast event #${event.id} → (${event.position.x}, ${event.position.y}) m to ${sent} client(s)`);
  }
}

/** Returns the number of currently connected WebSocket clients. */
function clientCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = { init, broadcastEvent, clientCount };
