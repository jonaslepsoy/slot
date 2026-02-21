/**
 * cli.js
 *
 * Interactive command-line interface for the Sound Localization Server.
 * Allows the operator to switch server modes, view status, and see results
 * without needing an external HTTP client.
 */

const readline = require('readline');
const { DEVICES } = require('./config');
const store = require('./store');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  prompt: '\njeloy-xii> ',
});

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          Sound Localization Server — Commands        ║
╠══════════════════════════════════════════════════════╣
║  mode sync       Switch to sync mode                 ║
║                  (next packets treated as sync data) ║
║  mode localize   Switch to localize mode             ║
║  status          Show server status and offsets      ║
║  results         Show recent localized events        ║
║  reset sync      Clear clock offsets                 ║
║  help            Show this help                      ║
║  quit / exit     Stop the server                     ║
╚══════════════════════════════════════════════════════╝`);
}

// ── Sync packet notification ──────────────────────────────────────────────────
// Called by routes/packet.js when a packet arrives in sync mode,
// so the CLI can print live progress to the operator.

function onSyncPacketReceived(deviceId, timestamp) {
  if (store.getMode() !== 'sync') return;
  const deviceIds = Object.keys(DEVICES);
  const syncBuffer = store.getSyncBuffer();
  const waiting = deviceIds.filter(id => syncBuffer[id] === undefined && id !== deviceId);
  console.log(`\n  ✓ ${deviceId} synced (timestamp: ${timestamp.toFixed(3)} ms)`);
  if (waiting.length > 0) {
    console.log(`  Waiting for: ${waiting.join(', ')}`);
    rl.prompt();
  }
}

// ── Command handler ────────────────────────────────────────────────────────────

function handleCommand(line) {
  const args = line.trim().toLowerCase().split(/\s+/);
  const cmd = args[0];

  switch (cmd) {
    case 'mode': {
      const target = args[1];
      if (target === 'sync') {
        store.setMode('sync');
        store.clearSyncBuffer();
        store.clearOffsets();
        console.log('\n  ✓ Switched to sync mode.');
        console.log('  Place all phones side-by-side, make a sharp sound,');
        console.log('  and have each phone send a packet to POST /packet.\n');
      } else if (target === 'localize') {
        store.setMode('localize');
        store.clearSyncBuffer();
        console.log('\n  ✓ Switched to localize mode.\n');
      } else {
        console.log('\n  Usage: mode sync | mode localize\n');
      }
      break;
    }

    case 'status': {
      const offsets = store.getAllOffsets();
      const pending = store.getPendingPackets();
      const events = store.getSoundEvents();
      const mode = store.getMode();
      const isSynced = Object.keys(DEVICES).every(id => offsets[id] !== undefined);
      console.log(`\n  Mode:            ${mode}`);
      console.log(`  Synced:          ${isSynced ? 'Yes' : 'No (run "mode sync" to start a sync session)'}`);
      if (Object.keys(offsets).length > 0) {
        console.log('  Offsets (ms):');
        Object.entries(offsets).forEach(([id, o]) => console.log(`    ${id}: ${o >= 0 ? '+' : ''}${o.toFixed(3)} ms`));
      }
      console.log(`  Pending packets: ${pending.length}`);
      console.log(`  Total events:    ${events.length}\n`);
      break;
    }

    case 'results': {
      const events = store.getSoundEvents();
      if (events.length === 0) {
        console.log('\n  No events yet.\n');
      } else {
        console.log(`\n  Last ${Math.min(5, events.length)} event(s):`);
        events.slice(-5).reverse().forEach(e => {
          console.log(`    #${e.id}  (${e.position.x}, ${e.position.y}) m  — ${e.createdAt}`);
        });
        console.log('');
      }
      break;
    }

    case 'reset':
      if (args[1] === 'sync') {
        store.clearOffsets();
        store.clearSyncBuffer();
        console.log('\n  ✓ Sync offsets cleared.\n');
      } else {
        console.log('\n  Usage: reset sync\n');
      }
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

  rl.prompt();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function start() {
  printHelp();
  rl.prompt();
  rl.on('line', line => handleCommand(line));
  rl.on('close', () => process.exit(0));
}

module.exports = { start, onSyncPacketReceived };
