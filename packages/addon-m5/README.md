# @codesense/addon-m5

The **CoreS3 orb** addon bridge — a status display + standalone controller for
Claude Code on an M5Stack CoreS3. Fully decoupled from the DualSense: this
package never imports `@codesense/hid` and never modifies the daemon. It's a
plain localhost WebSocket **client** of the daemon, exactly like the dashboard.

```
daemon snapshot ──▶ HudFrame ──▶ transport(s) ──▶ orb
orb DeviceEvent ──▶ daemon ClientMessage ──▶ daemon ws
```

The firmware lives in [`firmware/m5-cores3`](../../firmware/m5-cores3) and shares
`wire.ts` + `framing.ts` from this package, so the protocol is defined once.

## Run

```bash
# a daemon (your real one, or a mock; sdk backend needs no external claude)
node ../cli/dist/index.js start --mock --backend sdk

# the bridge + browser emulator
node dist/index.js                 # → http://127.0.0.1:3838/
node dist/index.js --demo          # no daemon: cycle state for UI work
node dist/index.js doctor          # check daemon + list serial ports
```

## Transports (pluggable, phased)

| Flag | Transport | Phase | Notes |
|---|---|---|---|
| _(default)_ | WebSocket | P1 | serves the emulator + real orb over WiFi/LAN |
| `--serial <path>` | USB-CDC serial | P2 | docked/offline; needs `serialport` (lazy) |
| `--mqtt <url>` | MQTT | P3 | fleet/remote via a broker; needs `mqtt` (lazy) |

`serialport` and `mqtt` are loaded lazily, so this package builds and its tests
run without them. Install only what you use:

```bash
pnpm --filter @codesense/addon-m5 add serialport   # for --serial
pnpm --filter @codesense/addon-m5 add mqtt          # for --mqtt
```

Add `--token <str>` to require devices to authenticate (`{"t":"hello","token":…}`).
Use `--host 0.0.0.0` to expose the WiFi transport on the LAN for a physical orb.

## Key options

```
--daemon <url>     daemon ws (default ws://127.0.0.1:3737/ws)
--port <n>         device/emulator port (default 3838)
--host <addr>      bind address (default 127.0.0.1)
--token <str>      device auth token
--serial <path>    also serve over serial (e.g. COM3)   --baud <n>
--mqtt <url>       also serve over MQTT   --mqtt-prefix <s>
--demo             synthesize state; no daemon
--no-emulator      don't serve the emulator
```

## Layout

- `wire.ts` — shared `HudFrame` / `DeviceEvent` types (dependency-free)
- `framing.ts` — shared newline-JSON framing (dependency-free)
- `protocol.ts` — re-exports wire + maps `DeviceEvent` → daemon `ClientMessage`
- `hud.ts` — `DaemonSnapshot` → `HudFrame`
- `bridge.ts` — daemon client + device hub + `--demo`
- `transports/` — `Transport` interface + ws / serial / mqtt
- `doctor.ts` — diagnostics
- `emulator/` — browser stand-in for the orb

See [`docs/addon-m5-cores3.md`](../../docs/addon-m5-cores3.md) for the full design.
