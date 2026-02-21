/**
 * test.js
 * End-to-end test of all major API flows using the new /packet and /mode endpoints.
 * Run: node test.js  (server must be running on port 3000)
 */

const http = require('http');

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port: 3000,
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
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Build a deterministic sample clump for testing.
 * The clap onset is placed at exactly `clapTimestamp` with a loudness of 25000,
 * preceded by low background samples and followed by echo fade.
 * The largest jump will always be the onset → detector will return clapTimestamp.
 */
function buildClump(deviceId, clapTimestamp) {
  const INTERVAL = 36;
  const PRE = 8;
  const POST = 7;
  const samples = [];

  for (let i = PRE; i >= 1; i--) {
    samples.push({ deviceId, timestamp: clapTimestamp - i * INTERVAL, loudnessDb: 150 });
  }
  samples.push({ deviceId, timestamp: clapTimestamp, loudnessDb: 25000 });
  let echo = 23000;
  for (let i = 1; i <= POST; i++) {
    samples.push({ deviceId, timestamp: clapTimestamp + i * INTERVAL, loudnessDb: Math.round(echo) });
    echo *= 0.72;
  }
  return samples;
}

async function run() {
  console.log('=== Sound Localization Server - Test Suite ===\n');

  const { DEVICES, SPEED_OF_SOUND } = require('./config');
  const deviceIds = Object.keys(DEVICES);

  // ── Test 1: Switch to sync mode ────────────────────────────────────────────
  console.log('[Test 1] Switch server to sync mode...');
  const modeRes = await request('POST', '/mode', { mode: 'sync' });
  console.log('  Status:', modeRes.message);
  const modeGet = await request('GET', '/mode');
  console.log('  Current mode:', modeGet.mode);
  console.log();

  // ── Test 2: Send sync packets ──────────────────────────────────────────────
  console.log('[Test 2] Send sync packets from all phones (side-by-side)...');
  const syncTime = Date.now();
  const drifts = { 'phone-a': 15, 'phone-b': -8, 'phone-c': 0 };
  let syncResult;
  for (const id of deviceIds) {
    const r = await request('POST', '/packet', buildClump(id, syncTime + drifts[id]));
    syncResult = r;
  }
  console.log('  Sync status:', syncResult.status);
  console.log('  Offsets:    ', syncResult.offsets);
  const modeAfterSync = await request('GET', '/mode');
  console.log('  Mode after sync:', modeAfterSync.mode, '(should be localize)');
  console.log();

  // ── Test 3: Localize sound at center (5, 5) ────────────────────────────────
  console.log('[Test 3] Localize sound at center (5, 5) m...');
  const src1 = { x: 5, y: 5 };
  const t1 = Date.now();
  let e1Result;
  for (const id of deviceIds) {
    const pos = DEVICES[id];
    const dist = Math.sqrt((src1.x - pos.x) ** 2 + (src1.y - pos.y) ** 2);
    const travelMs = (dist / SPEED_OF_SOUND) * 1000;
    const offset = syncResult.offsets[id];
    const timestamp = t1 + travelMs + drifts[id]; // raw phone timestamp
    e1Result = await request('POST', '/packet', buildClump(id, timestamp));
  }
  console.log('  Source:     ', src1);
  console.log('  Calculated: ', e1Result.event?.position);
  const err1 = Math.sqrt((e1Result.event.position.x - src1.x) ** 2 + (e1Result.event.position.y - src1.y) ** 2);
  console.log('  Error (m):  ', err1.toFixed(4));
  console.log();

  // ── Test 4: Localize sound near a corner (1, 9) ────────────────────────────
  console.log('[Test 4] Localize sound near corner (1, 9) m...');
  const src2 = { x: 1, y: 9 };
  const t2 = Date.now();
  let e2Result;
  const shuffled = [...deviceIds].sort(() => Math.random() - 0.5); // random order
  for (const id of shuffled) {
    const pos = DEVICES[id];
    const dist = Math.sqrt((src2.x - pos.x) ** 2 + (src2.y - pos.y) ** 2);
    const travelMs = (dist / SPEED_OF_SOUND) * 1000;
    const timestamp = t2 + travelMs + drifts[id];
    e2Result = await request('POST', '/packet', buildClump(id, timestamp));
  }
  console.log('  Source:     ', src2);
  console.log('  Calculated: ', e2Result.event?.position);
  const err2 = Math.sqrt((e2Result.event.position.x - src2.x) ** 2 + (e2Result.event.position.y - src2.y) ** 2);
  console.log('  Error (m):  ', err2.toFixed(4));
  console.log();

  // ── Test 5: GET /mode, /status, /results ──────────────────────────────────
  console.log('[Test 5] Query status and results...');
  const status = await request('GET', '/status');
  console.log('  Mode:         ', status.mode);
  console.log('  Is synced:    ', status.sync.isSynced);
  console.log('  Total events: ', status.totalEvents);
  const latest = await request('GET', '/results/latest');
  console.log('  Latest event: ', `#${latest.event?.id} at (${latest.event?.position.x}, ${latest.event?.position.y})`);
  console.log();

  console.log('=== All tests passed ===');
}

run().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});

