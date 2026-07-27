# CodeSense CoreS3 orb — firmware (Moddable / TypeScript)

The orb firmware. TypeScript, built with the [Moddable SDK](https://www.moddable.com)
(XS engine) for the M5Stack CoreS3. It connects to the CodeSense **bridge**
(`@codesense/addon-m5`) over WebSocket, renders the agent state, and sends your
taps back as `DeviceEvent`s.

> **Status: P1 scaffold — not yet built or flashed.** The structure and logic
> are here; the Moddable API surface (fonts, Piu, wifi/websocket) must be
> validated on the first build against your installed SDK. See _Verify at build
> time_ below.

## What's here

| File | Role |
|---|---|
| `main.ts` | entry — wires the network layer to the HUD; default-exports the Piu `Application` |
| `net.ts` | `BridgeLink` (WiFi + WebSocket) and `SerialLink` (USB-CDC, P2), selected by `config.transport` |
| `ui.ts` | the Piu HUD (state strip, mode tabs, permission/state view, session dots, mic) |
| `manifest.json` | Moddable manifest — targets `esp32/m5stack_cores3`, config, module map |
| `moddable.d.ts` / `tsconfig.json` | editor IntelliSense only (not used at build) |

**Shared code with the bridge.** `manifest.json` includes the bridge's
`packages/addon-m5/src/wire.ts` (`HudFrame` / `DeviceEvent`) and `framing.ts`
(newline-JSON for serial) as the `wire` and `framing` modules, so the protocol
and framing are defined **once** and used on both sides. Both files are
dependency-free on purpose — don't add imports to them.

**Transport.** `config.transport` selects `"wifi"` (default, P1) or `"serial"`
(P2, docked over USB-C). Serial shares `framing.ts` with the bridge's
`SerialTransport`; run the bridge with `--serial COM3` on the host side.

## Prerequisites

1. Install the **Moddable SDK** and the **ESP32 (ESP-IDF) tooling** — follow
   Moddable's "Getting Started" for your OS. Confirm `echo $MODDABLE` resolves
   and `mcconfig` is on your PATH.
2. Device connected over USB-C. On this machine it enumerates as **COM3**
   (Espressif `303A:1001`, native USB-CDC).

## Configure

Edit `manifest.json` → `config`:

```jsonc
"wifi":   { "ssid": "…", "password": "…" },
"bridge": { "host": "<your PC's LAN IP>", "port": 3838, "token": "" }
```

`bridge.host` is the machine running the bridge. Because the orb reaches it over
WiFi, start the bridge bound to the LAN (not just localhost):

```bash
# on the daemon host
node packages/cli/dist/index.js start --mock --backend sdk      # or your real daemon
node packages/addon-m5/dist/index.js --host 0.0.0.0             # bridge, LAN-visible
```

(Optionally set a `--token` on the bridge and the same value in `config.bridge.token`.)

## Build & flash

```bash
cd firmware/m5-cores3
mcconfig -d -m -p esp32/m5stack_cores3        # -d debug, -m make; device on COM3
```

`-d` gives you `xsbug` traces over USB. For a release build drop `-d`.

## First light (P1 acceptance)

With the daemon + bridge running and WiFi configured, the CoreS3 screen should
mirror the live agent state (idle blue → thinking purple → amber on permission),
and tapping the mode tabs / (soon) approve buttons should round-trip — watch the
bridge and daemon logs to confirm the events land.

## Verify at build time

This is a scaffold; the following Moddable-specific bits are the most likely to
need adjustment on first build:

- **Fonts** — `ui.ts` references an `Open Sans` family. Add the font(s) to the
  manifest `resources` (see Moddable Piu examples) or switch to a bundled font.
- **Piu API** — `Skin` color string format, `Style` options, and the touch
  `Behavior` method names/signatures can vary by SDK version.
- **wifi / websocket / timer** — confirm the `Client` callback message
  constants and the `WiFi` monitor message values match your SDK.
- **Approve buttons** — `ui.ts` currently shows the permission request text;
  the three approve/always/reject tap targets are stubbed with a note and get
  wired in as the first on-device task (events already exist in `wire.ts`).

## Scope

P1 = WiFi + display + touch + render. IMU gestures, audio tones, serial
transport, and sleep are P2+ (see `docs/addon-m5-cores3.md`). Per the Moddable
decision there, watch for CoreS3 peripheral driver coverage (BMI270 / AW88298 /
AXP2101) when P2 begins.
