/**
 * simulator.js
 *
 * Standalone simulation application.
 * Runs alongside the server and emulates three phones sending data packets.
 *
 * Usage:
 *   node simulator.js [--host localhost] [--port 3000]
 *
 * Commands (interactive):
 *   sync            Tell server to enter sync mode, then send sync packets
 *                   from all three phones (simulating phones side-by-side).
 *   event           Simulate a sound event at a random position.
 *   event X Y       Simulate a sound event at position (X, Y) metres.
 *   drifts          Show current simulated clock drifts.
 *   reset drifts    Re-randomize simulated clock drifts.
 *   status          Query and display server status.
 *   help            Show available commands.
 *   quit / exit     Exit the simulator.
 */

const http = require('http');
const readline = require('readline');
const { DEVICES, SPEED_OF_SOUND } = require('./config');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const hostIdx = args.indexOf('--host');
const portIdx = args.indexOf('--port');
const SERVER_HOST = hostIdx !== -1 ? args[hostIdx + 1] : 'localhost';
const SERVER_PORT = portIdx !== -1 ? parseInt(args[portIdx + 1]) : 3000;

// ── Simulated clock drifts ────────────────────────────────────────────────────
// Represent natural clock offsets of each phone (ms). Consistent across sync
// and event simulation so that sync correctly cancels them out.
const drifts = {};

function randomizeDrifts() {
  Object.keys(DEVICES).forEach(id => {
    drifts[id] = parseFloat(((Math.random() * 100) - 50).toFixed(3));
  });
}

randomizeDrifts();

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data && { 'Content-Length': Buffer.byteLength(data) }),
      },
    };
    const req = http.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', err => reject(new Error(`Cannot reach server at ${SERVER_HOST}:${SERVER_PORT} — ${err.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Clump builder ─────────────────────────────────────────────────────────────

/**
 * Build an array of loudness samples simulating background noise → sharp clap
 * onset → echo fade, matching the shape phones actually send.
 *
 * @param {string} deviceId
 * @param {number} clapTimestamp  True arrival time of the clap (ms)
 * @param {number} peakLoudness   Peak dB at onset (default ~25000)
 * @returns {Array<{ deviceId, timestamp, loudnessDb }>}
 */
function buildClump(deviceId, clapTimestamp, peakLoudness = 25000) {
  const INTERVAL = 36; // ~36 ms between samples (≈27 Hz)
  const PRE  = 8;      // background samples before clap
  const POST = 7;      // echo fade samples after clap
  const samples = [];

  // Background noise — low, slightly jittery
  for (let i = PRE; i >= 1; i--) {
    const t = clapTimestamp - i * INTERVAL + Math.round((Math.random() - 0.5) * 4);
    const db = Math.round(100 + Math.random() * 120); // 100–220
    samples.push({ deviceId, timestamp: t, loudnessDb: db });
  }

  // Clap onset — the sample the detector will pick
  samples.push({ deviceId, timestamp: clapTimestamp, loudnessDb: peakLoudness });

  // Echo fade — exponentially decreasing
  let echoDB = peakLoudness * 0.92;
  for (let i = 1; i <= POST; i++) {
    const t = clapTimestamp + i * INTERVAL + Math.round((Math.random() - 0.5) * 4);
    samples.push({ deviceId, timestamp: t, loudnessDb: Math.round(echoDB) });
    echoDB *= 0.72; // decay factor per step
  }

  return samples;
}

// ── Simulation logic ──────────────────────────────────────────────────────────

async function simulateSync() {
  console.log('\n  Switching server to sync mode...');
  const modeRes = await request('POST', '/mode', { mode: 'sync' });
  if (modeRes.status !== 200) {
    console.log(`  ✗ Failed to set sync mode: ${JSON.stringify(modeRes.body)}\n`);
    return;
  }
  console.log('  ✓ Server is now in sync mode.');
  console.log('\n  Simulating all phones placed side-by-side and detecting a sync sound...');

  const deviceIds = Object.keys(DEVICES);
  const trueTime = Date.now();

  for (const id of deviceIds) {
    const timestamp = trueTime + drifts[id];
    const clump = buildClump(id, timestamp, 25000);
    console.log(`  → Sending ${clump.length}-sample clump from ${id} (drift: ${drifts[id] >= 0 ? '+' : ''}${drifts[id]} ms)`);
    const res = await request('POST', '/packet', clump);
    if (res.body.status === 'complete') {
      console.log('\n  ✓ Sync complete! Server switched back to localize mode.');
      console.log('  Calculated offsets (ms):');
      Object.entries(res.body.offsets).forEach(([devId, off]) => {
        console.log(`    ${devId}: ${off >= 0 ? '+' : ''}${off.toFixed(3)} ms`);
      });
    }
    await delay(20 + Math.random() * 30); // small random network delay
  }
  console.log('');
}

async function simulateEvent(srcX, srcY) {
  const roomSize = 10;
  const x = srcX !== undefined ? srcX : parseFloat((Math.random() * roomSize).toFixed(3));
  const y = srcY !== undefined ? srcY : parseFloat((Math.random() * roomSize).toFixed(3));

  console.log(`\n  Simulating sound at (${x}, ${y}) m...`);

  const trueEmission = Date.now();
  const deviceIds = Object.keys(DEVICES);

  // Shuffle send order to simulate non-deterministic arrival at server.
  const shuffled = [...deviceIds].sort(() => Math.random() - 0.5);

  let lastResponse = null;
  for (const id of shuffled) {
    const pos = DEVICES[id];
    const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
    const travelMs = (dist / SPEED_OF_SOUND) * 1000;
    // Reported timestamp = true arrival time + phone's clock drift
    const timestamp = trueEmission + travelMs + drifts[id];
    const peakLoudness = Math.round(28000 - dist * 400 + (Math.random() * 800 - 400));
    const clump = buildClump(id, timestamp, peakLoudness);
    console.log(`  → ${id}: dist=${dist.toFixed(3)} m, travel=${travelMs.toFixed(3)} ms, peak=${peakLoudness} dB, ${clump.length} samples`);
    const res = await request('POST', '/packet', clump);
    lastResponse = res;
    await delay(10 + Math.random() * 20);
  }

  if (lastResponse?.body?.status === 'localized') {
    const pos = lastResponse.body.event.position;
    const err = Math.sqrt((pos.x - x) ** 2 + (pos.y - y) ** 2);
    console.log(`\n  ✓ Sound localized at (${pos.x}, ${pos.y}) m`);
    console.log(`  Position error: ${err.toFixed(4)} m\n`);
  } else {
    console.log(`\n  Server response: ${JSON.stringify(lastResponse?.body)}\n`);
  }
  timeoutId = setTimeout(simulateEvent, 5000);
}

async function showStatus() {
  const res = await request('GET', '/status');
  const s = res.body;
  console.log('\n  Server status:');
  console.log(`    Mode:            ${s.mode || (await request('GET', '/mode')).body.mode}`);
  console.log(`    Synced:          ${s.sync?.isSynced ? 'Yes' : 'No'}`);
  if (s.sync?.offsets && Object.keys(s.sync.offsets).length > 0) {
    console.log('    Offsets (ms):');
    Object.entries(s.sync.offsets).forEach(([id, o]) => console.log(`      ${id}: ${o >= 0 ? '+' : ''}${o.toFixed(3)}`));
  }
  console.log(`    Pending packets: ${s.pendingPackets}`);
  console.log(`    Total events:    ${s.totalEvents}`);

  const modeRes = await request('GET', '/mode');
  console.log(`    Current mode:    ${modeRes.body.mode}\n`);
}

// ── Interactive CLI ───────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  prompt: '\nsimulator> ',
});

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║             Sound Localization Simulator             ║
╠══════════════════════════════════════════════════════╣
║  sync            Sync phones (switches server to     ║
║                  sync mode and sends sync packets)   ║
║  event           Simulate sound event (random pos)   ║
║  event X Y       Simulate sound event at (X, Y) m    ║
║  drifts          Show simulated phone clock drifts   ║
║  reset drifts    Re-randomize clock drifts           ║
║  status          Show server status                  ║
║  help            Show this help                      ║
║  quit / exit     Exit the simulator                  ║
╚══════════════════════════════════════════════════════╝`);
}

async function handleCommand(line) {
  const args = line.trim().split(/\s+/);
  const cmd = args[0]?.toLowerCase();

  try {
    switch (cmd) {
      case 'sync':
        await simulateSync();
        break;

      case 'event': {
        const x = args[1] !== undefined ? parseFloat(args[1]) : undefined;
        const y = args[2] !== undefined ? parseFloat(args[2]) : undefined;
        if ((args[1] !== undefined && isNaN(x)) || (args[2] !== undefined && isNaN(y))) {
          console.log('\n  Usage: event [X Y]  (X and Y must be numbers)\n');
        } else {
          await simulateEvent(x, y);
        }
        break;
      }

      case 'drifts':
        console.log('\n  Simulated clock drifts (ms):');
        Object.entries(drifts).forEach(([id, d]) => {
          console.log(`    ${id}: ${d >= 0 ? '+' : ''}${d} ms`);
        });
        console.log('');
        break;

      case 'reset':
        if (args[1] === 'drifts') {
          randomizeDrifts();
          console.log('\n  ✓ Drifts re-randomized:');
          Object.entries(drifts).forEach(([id, d]) => console.log(`    ${id}: ${d >= 0 ? '+' : ''}${d} ms`));
          console.log('');
        } else {
          console.log('\n  Usage: reset drifts\n');
        }
        break;

      case 'status':
        await showStatus();
        break;

      case 'help':
      case '?':
      case '':
        printHelp();
        break;

      case 'quit':
      case 'exit':
        console.log('\nGoodbye.\n');
        process.exit(0);
        break;

      default:
        console.log(`\n  Unknown command: "${cmd}". Type "help" for available commands.\n`);
    }
  } catch (err) {
    console.error(`\n  Error: ${err.message}\n`);
  }

  rl.prompt();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

console.log(`\nSound Localization Simulator`);
console.log(`Targeting server at http://${SERVER_HOST}:${SERVER_PORT}`);
console.log('\nSimulated clock drifts (ms):');
Object.entries(drifts).forEach(([id, d]) => console.log(`  ${id}: ${d >= 0 ? '+' : ''}${d} ms`));

printHelp();
rl.prompt();

rl.on('line', line => handleCommand(line));
rl.on('close', () => process.exit(0));
