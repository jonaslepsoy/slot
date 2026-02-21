# jeloy-xii — Sound Localization Server

A Node.js server that receives sound event data from three client phones and calculates the (X, Y) position of the sound source in a room using **Time Difference of Arrival (TDOA)**.

---

## How It Works

1. **Three phones** are placed at known positions in the room.
2. When a sharp sound occurs, each phone detects it and sends a packet to `POST /packet` with its `deviceId`, `timestamp` (ms), and `loudnessDb`.
3. Phones **always send to the same endpoint** — the server decides how to handle packets based on its current mode.
4. The server **corrects for clock drift** using pre-calculated offsets from a sync session.
5. The server **groups the three packets** and solves for the (X, Y) position of the sound source using TDOA trilateration.

### Server Modes

| Mode | Behaviour |
|------|----------|
| `localize` | Packets are treated as sound event data and localized. This is the default. |
| `sync` | Packets are treated as sync pulse timestamps. Once all devices have reported, offsets are calculated and the server automatically switches back to `localize`. |

### TDOA Localization

The difference in arrival times between phones tells us the difference in distance from the sound source to each phone. Given three receivers at known positions, the server uses a **Gauss-Newton iterative solver** to find the (X, Y) position that best satisfies all time difference constraints.

Speed of sound assumed: **343 m/s** (adjustable in `config.js`).

---

## Clock Synchronization — "Sync Phones" Mode

Phone clocks are not perfectly synchronized. To correct for this:

1. Place all three phones **side-by-side** in the room.
2. Switch the server to sync mode (via the server CLI: `mode sync`, or via `POST /mode`).
3. Make a **sharp sound** (clap, snap, etc.).
4. Each phone detects the sound and sends its packet to `POST /packet` — the same endpoint as always.
5. Once all three phones have reported, the server calculates and stores clock offsets per device, then **automatically switches back to localize mode**.

Repeat the sync process periodically to correct for clock drift over time.

---

## Room & Device Configuration

Edit [`config.js`](config.js) to match your room setup:

```js
// Device positions in meters (x, y). Origin at bottom-left corner.
const DEVICES = {
  'phone-a': { x: 0.0,  y: 0.0  },  // bottom-left corner
  'phone-b': { x: 10.0, y: 0.0  },  // bottom-right corner
  'phone-c': { x: 5.0,  y: 10.0 },  // top-center
};

const SPEED_OF_SOUND = 343; // m/s
const EVENT_WINDOW_MS = 200; // ms — max time between packets to group as same event
```

Place phones as far apart as possible (e.g. corners/edges) for best localization accuracy.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

### Install

```bash
npm install
```

### Run the server

```bash
npm start
```

The server starts on port `3000` by default. Set the `PORT` environment variable to override:

```bash
PORT=8080 npm start
```

### Run the simulator (in a second terminal)

```bash
npm run simulate
```

The simulator connects to the server and emulates all three phones sending packets.

---

## API Reference

### Sync Phones

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sync` | Report sync pulse detection from a phone |
| `GET` | `/sync/status` | View current sync state and clock offsets |
| `DELETE` | `/sync` | Reset all sync data |

**POST /sync** — Body:
```json
{ "deviceId": "phone-a", "timestamp": 1700000000000 }
```

Response when all devices have reported:
```json
{
  "status": "synced",
  "offsets": { "phone-a": 0, "phone-b": -10, "phone-c": 5 }
}
```

---

### Sound Events

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sound-event` | Report a detected sound event from a phone |

**POST /sound-event** — Body:
```json
{ "deviceId": "phone-a", "timestamp": 1700000001234, "loudnessDb": 78.5 }
```

Response when all three devices have reported and the position is solved:
```json
{
  "status": "localized",
  "event": {
    "id": 1,
    "position": { "x": 4.21, "y": 7.83, "residual": 0.0002 },
    "devices": [...],
    "timespanMs": 18.4,
    "createdAt": "2026-02-21T10:00:00.000Z"
  }
}
```

---

### Results

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/results` | All localized sound events (last 100) |
| `GET` | `/results/latest` | Most recent localized event |
| `GET` | `/status` | Server status, device config, sync state |

---

## Server CLI

When the server is running, type commands directly in the server terminal:

```
jeloy-xii> mode sync       Switch to sync mode
jeloy-xii> mode localize   Switch to localize mode
jeloy-xii> status          Show mode, offsets, pending packets, events
jeloy-xii> results         Show the 5 most recent localized events
jeloy-xii> reset sync      Clear clock offsets
jeloy-xii> help            Show all commands
```

---

## Simulator CLI

Run in a separate terminal (`npm run simulate`):

```
simulator> sync            Switch server to sync mode and send sync packets
simulator> event           Simulate a sound event at a random position
simulator> event X Y       Simulate a sound event at (X, Y) metres
simulator> drifts          Show simulated phone clock drifts
simulator> reset drifts    Re-randomize phone clock drifts
simulator> status          Show server status
simulator> help
```

The simulator maintains consistent simulated clock drifts across sync and event sessions, so syncing correctly cancels them out.

---

## Accuracy

Localization accuracy depends primarily on **timestamp accuracy**:

| Timestamp Accuracy | Positioning Accuracy (approx.) |
|--------------------|-------------------------------|
| 1 ms               | ~30 cm                        |
| 0.1 ms (100 μs)    | ~3 cm                         |
| 10 ms              | ~3 m                          |

For sub-meter accuracy, phone clocks should be synchronized to within **1 ms**, achieved via the Sync Phones mode described above.

---

## Project Structure

```
jeloy-xii/
├── server.js              Entry point — Express server setup and CLI
├── cli.js                 Interactive server CLI (mode switching, status)
├── simulator.js           Standalone simulator app (emulates all 3 phones)
├── config.js              Room dimensions, device positions, constants
├── store.js               In-memory state (mode, offsets, packets, events)
├── eventProcessor.js      Groups packets and triggers localization
├── localization/
│   └── tdoa.js            2D Gauss-Newton TDOA solver
└── routes/
    ├── packet.js          Single packet endpoint (handles sync + localize)
    ├── mode.js            Mode control endpoints
    └── results.js         Results and status endpoints
```

---

## Running the Test Suite

With the server running (`npm start`), in another terminal:

```bash
node test.js
```

The test suite covers mode switching, sync via `/packet`, and TDOA localization via `/packet`, reporting position error for each test case.
