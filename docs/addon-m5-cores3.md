# Addon: M5Stack CoreS3 status orb + standalone controller

> **Status (2026‑07‑27):** **P0 built & verified**; **P1 firmware scaffolded**
> (Moddable/TypeScript, awaiting a toolchain install + flash); **P2 serial
> transport landed**; **P3 host side landed** (MQTT transport + `doctor` +
> multi-transport CLI). The `packages/addon-m5` bridge, ws + serial + mqtt
> transports, browser emulator, and 23 unit tests pass, with an end-to-end
> round trip verified against a live mock daemon. Remaining before "done":
> the firmware toolchain install + flash (P1 hardware), on-device peripherals
> (P2 hardware), and WiFi OTA (P3). This is the spec agreed in the 2026‑07‑25
> design interview.
>
> **Branch:** `feature/addon-support`. This is the first *addon* — a template
> for how future devices bolt onto CodeSense without touching the core.

## 1. What this is

A stock **M5Stack CoreS3** (ESP32‑S3, 2.0" 320×240 capacitive‑touch IPS,
1W speaker, dual mic, 6‑axis IMU, camera, RTC, microSD, native USB‑C, WiFi
2.4 GHz) becomes a second **surface** for CodeSense:

- a **glanceable status orb** — its screen color‑mirrors the lightbar state
  (idle / thinking / permission / done / error), shows the pending permission
  as a card, and shows session dots; and
- a **full standalone controller** — you can drive Claude Code entirely from
  the orb (approve/reject, switch modes, switch sessions, fire preset prompts,
  push‑to‑talk) with **no DualSense connected**.

It complements the controller but never depends on it.

## 2. Guiding principle — total separation

**The orb is completely decoupled from the DualSense/PS5 controller.** This is
a hard design rule from the interview, and it shapes the whole architecture:

- The orb code **must not** import `@codesense/hid` or touch `protocol.ts`,
  `device.ts`, or the DualSense feedback path.
- The **daemon is not modified.** The orb integrates as an ordinary
  authenticated WebSocket client of the daemon — *exactly like the dashboard*
  (`packages/cli/src/server.ts`). It receives the same `snapshot` / `palette` /
  `log` / `transcript` broadcasts and sends the same `action` / `set-mode` /
  `prompt` / `palette-*` messages.
- All orb concerns (device transports, screen frames, audio, gestures, auth)
  live in a **separate addon package + firmware directory**. Deleting the
  addon leaves the controller path untouched.

The seam that makes this possible already exists: the daemon abstracts the
backend *below* the action layer (`daemon.ts` `handleAction` routes
`approve`/`reject` to pty‑keystrokes or sdk‑promises internally), and
`DaemonSnapshot` already carries a **device‑agnostic** `FeedbackFrame` plus
`agentState`, `mode`, `sessions`, and `pendingPermission`. The orb consumes
that contract; it does not reimplement any of it.

## 3. Architecture

```
                    ┌──────────────────────────── daemon host ────────────────────────────┐
                    │                                                                       │
  DualSense ⇄ HID ⇄ │  Daemon ── ws /ws @127.0.0.1:3737 ──┬── Dashboard (browser)          │
   (untouched)      │   backends: pty | sdk               │                                │
                    │                                     └── addon-m5 bridge  (NEW)        │
                    │                                          • ws client (localhost)      │
                    │                                          • snapshot → HudFrame        │
                    │                                          • DeviceEvent → ClientMessage│
                    │                                          • pluggable transports ──────┼──► CoreS3 orb
                    │                                          • device auth (token)        │     (firmware)
                    └───────────────────────────────────────────────────────────────────────┘
```

- The **bridge** (`packages/addon-m5`) runs on the daemon host and connects to
  the daemon over **localhost** — so the daemon needs **zero** new network
  bind, no new token, no M5‑specific code. Maximum separation.
- The bridge owns everything device‑facing: it computes a slim **HudFrame**
  from the daemon snapshot, exposes the device transports to the LAN/cable
  with **its own** token, and maps inbound **DeviceEvent**s back onto the
  daemon's existing `ClientMessage` vocabulary.
- The **firmware** only ever talks to the bridge, so it only ever sees compact
  frames — it never parses the full snapshot JSON.

### Why a bridge instead of firmware-direct-to-daemon
A direct firmware→daemon WiFi socket would force daemon changes (LAN bind +
token + a slim broadcast) and make the MCU parse heavy snapshot JSON. The
localhost bridge keeps the daemon pristine, keeps the wire skinny, and is the
only place transport/auth complexity lives. Rejected: firmware‑direct.

## 4. Device wire protocol (bridge ⇄ firmware)

Compact JSON for v1 (swap to a packed binary frame only if bandwidth/CPU
demands it on the serial/BLE paths). Two message directions:

### Down — `HudFrame` (bridge → device), sent on change, ≤ ~10 Hz
```jsonc
{
  "t": "hud",
  "state": "permission",          // AgentStateName
  "hex": "#FFB020",               // STATE_HEX[state] — screen tint
  "mode": "AGENT",                // AGENT | NAV | PROMPT
  "needsYou": true,               // state === 'permission' (or waiting session)
  "perm": { "tool": "Bash", "detail": "rm -rf build/" },  // when pending
  "backend": "pty",               // pty | sdk | none  → mic button enable
  "sessions": [                   // [] for pty, up to 4 for sdk
    { "slot": 1, "state": "thinking", "active": true, "label": "web", "costUsd": 0.12 }
  ],
  "presets": [ { "id": "tests", "label": "run tests" } ],  // from profile
  "battery": { "level": 0.82, "charging": true }           // device-local
}
```

### Up — `DeviceEvent` (device → bridge)
```jsonc
{ "t": "approve", "scope": "once" }          // or "always"
{ "t": "reject" }
{ "t": "mode", "mode": "NAV" }
{ "t": "session", "target": 2 }              // or "next" | "prev"
{ "t": "preset", "id": "tests" }
{ "t": "voice", "phase": "pushStart" }       // pushStart | pushEnd  (pty only)
{ "t": "palette", "op": "open"|"select"|"confirm"|"close", "arg": 0 }
{ "t": "interrupt" } | { "t": "rewind" }
{ "t": "gesture", "name": "shake"|"tilt-up"|"tilt-down"|"wake" }
{ "t": "hello", "fw": "0.1.0", "token": "…" }   // handshake / auth
```

### Bridge mapping — `DeviceEvent` → existing daemon `ClientMessage`
| DeviceEvent | Daemon ClientMessage |
|---|---|
| `approve/once` | `{type:'action', action:{type:'approve', scope:'once'}}` |
| `approve/always` | `{type:'action', action:{type:'approve', scope:'always'}}` |
| `reject` | `{type:'action', action:{type:'reject'}}` |
| `mode` | `{type:'set-mode', mode}` |
| `session` | `{type:'action', action:{type:'session', target}}` |
| `preset` | `{type:'prompt', text}` **or** the preset's bound `action` |
| `voice/push*` | `{type:'action', action:{type:'voice', action:'pushStart'|'pushEnd'}}` |
| `palette` | `{type:'palette-select|confirm|close'}` / `{type:'action',action:{type:'palette'}}` |
| `interrupt` / `rewind` | `{type:'action', action:{type:'interrupt'|'rewind'}}` |

All of these already work for a real (non‑mock) daemon over the existing ws —
only `sim-*` messages require mock mode, and the orb never uses those.

## 5. UX design

### Screen layout (320×240)
```
┌───────────────────────────────────────────┐
│  AGENT · NAV · PROMPT        [mode tabs]   │  ~24px persistent tab strip
├───────────────────────────────────────────┤
│                                           │
│        ● PERMISSION                        │  status zone, tinted to STATE_HEX
│        Bash: rm -rf build/                 │  permission card when pending
│                                           │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐  │  three explicit approve buttons
│   │ APPROVE  │ │  ALWAYS  │ │ ✕ REJECT │  │  (only shown in `permission`)
│   │  once    │ │          │ │          │  │
│   └──────────┘ └──────────┘ └──────────┘  │
│                                           │
│   ○ ● ○ ○     session dots (sdk)  🎤 mic   │  footer: sessions + voice + battery
└───────────────────────────────────────────┘
```
- **Idle/thinking/done/error:** the status zone fills with the state tint and a
  short label; approve buttons are hidden. Motion matches the controller's
  language (breathe on thinking, flash on error).
- **Permission:** three big tap targets — **Approve once / Always / Reject**
  (chosen over a drag slider for clarity and mis‑approval safety).
- **Mode tab strip** (AGENT / NAV / PROMPT) is always visible for glanceable
  standalone use; tap to switch.
- **Session dots** mirror the player‑LED mask: filled = active, blinking =
  waiting on you. Tap a dot to switch sessions (sdk). Hidden on pty.
- **Mic button** triggers Claude Code's `/voice` push‑to‑talk. **pty‑only** —
  greyed out when `backend !== 'pty'` (sdk has no terminal to type into). No
  audio is ever captured or processed on the device (honors the no‑bundled‑STT
  rule).

### Colors (from the CodeSense design system, `renderer.ts`)
| State | Screen hex | Meaning |
|---|---|---|
| idle | `#3E9BFF` Sense Blue | calm, ready |
| thinking | `#9D7CFF` purple | working (slow breathe) |
| permission | `#FFB020` amber | **needs you** (pulse) |
| done | `#2FD48A` green | finished (fades to idle) |
| error | `#FF5C5C` red | failed (sharp flash) |
| disconnected | `#5C6470` grey | no backend |

### Audio — distinct tones per state
Short, tuned cues off the speaker so awareness carries across the room where
haptics can't: a rising two‑note for **permission/needs‑you**, a soft blip for
**done**, a low buzz for **error**, quiet ticks for subagent finished. Tones
are mutable; volume follows a device setting. (Tone design is **confirm**.)

### Motion gestures (BMI270)
- **Pick‑up / flick → wake** from a dimmed/slept screen (no tap needed).
- **Shake → dismiss** the current attention nudge (and, **confirm**, optionally
  reject a pending permission — needs a guard so it can't fire accidentally).
- **Tilt → scroll** the palette / session list one‑handed.

### Standalone text entry — presets + voice, no keyboard
Free text never requires the tiny on‑screen keyboard. Two paths:
- **Preset prompt snippets** — a palette of canned prompts (e.g. "run tests",
  "explain this", "commit"), sourced from the profile, tapped to send.
- **Voice** — the mic button fires `/voice` for everything else (pty).

### Power & sleep
Always‑on at full brightness when USB‑powered (docked). On battery (~500 mAh):
dim after idle, then light‑sleep; **wake on touch or motion**. RTC keeps a
clock face on the idle screen.

## 6. Transports — pluggable, phased

The bridge defines one `Transport` interface (`open`, `send(frame)`,
`on('event')`, `close`) with multiple implementations that can coexist. Rollout
order (agreed): **WiFi → Serial → MQTT**.

1. **WiFi WebSocket (P1).** The desired untethered orb on the solid home LAN.
   The bridge hosts a small LAN ws that serves only HudFrames; the firmware
   connects with its device token. Reuses the whole message shape; delivers the
   roaming experience first.
2. **USB‑CDC serial (P2).** The CoreS3's native USB gives power + data on one
   cable. Fully offline, most reliable when docked, no LAN surface. The bridge
   reads the port via `serialport`. Serial is also the **pairing** channel from
   day one (see §8), so its plumbing lands early even though it's promoted to a
   full transport in P2.
3. **MQTT (P3).** For a fleet or remote/away‑from‑desk. The bridge publishes
   HudFrames and subscribes to DeviceEvents via a broker (Mosquitto). Optional.

## 7. Firmware toolchain — **Moddable SDK (TypeScript)** (decided 2026‑07‑27)

Chosen for language consistency with the rest of CodeSense (the DualSense path
is TypeScript too) and so the `HudFrame`/`DeviceEvent` protocol types are
**shared** between the bridge and the firmware — one source of truth.

- **Runtime:** Moddable SDK / XS engine (≈99% of the 2025 JS standard),
  official `m5stack_cores3` build target, Piu/Commodetto for the touch UI.
- **Language:** TypeScript, transpiled to JS for the XS engine.
- **Watch item (P2):** Moddable does not give you `M5Unified`, so the CoreS3's
  IMU (BMI270), audio codec (AW88298), and PMIC (AXP2101) depend on Moddable's
  target coverage. P1 (WiFi + display + touch + render) is unaffected; treat
  peripheral drivers as a P2 checkpoint.
- **Fallback:** if a required P2 peripheral has no Moddable driver, either write
  a small one or drop that piece to Arduino + `M5Unified` + `LVGL` (C++). The
  JSON wire protocol makes the firmware language swappable without touching the
  bridge.

## 8. Security & pairing

- **Pairing:** first‑time setup over the **USB cable while docked** — a
  `codesense pair` (bridge) command pushes SSID + a generated **device token**
  over serial and stores it on the orb (NVS). Simplest and most reliable; no
  captive portal.
- **Auth:** the device token is presented in the `hello` handshake on every
  transport; the bridge rejects unknown tokens. TLS is out of scope for the
  trusted home LAN in v1 (revisit for MQTT/remote).
- The daemon's own ws stays localhost‑only and unauthenticated as today — the
  bridge is the only thing exposed to the LAN, and it owns its own auth.

## 9. Repo layout

```
packages/addon-m5/              # the bridge (Node/TS, ESM) — built ✅
  src/
    index.ts                    # CLI entry: `codesense-m5`
    bridge.ts                   # daemon ws client + device hub + demo mode
    hud.ts                      # DaemonSnapshot → HudFrame
    wire.ts                     # SHARED wire types (dependency-free) ← firmware too
    framing.ts                  # SHARED newline-JSON framing ← firmware too
    protocol.ts                 # re-exports wire.ts + daemon ClientMessage mapping
    doctor.ts                   # `codesense-m5 doctor` diagnostics
    mockDevice.ts               # in-process fake device for tests
    *.test.ts                   # protocol + hud + framing + mqtt tests (23, passing)
    transports/
      transport.ts              # Transport interface
      wsTransport.ts            # P1 ws (+ token auth, serves emulator) ✅
      serialTransport.ts        # P2 serial (lazy serialport) ✅
      mqttTransport.ts          # P3 mqtt (lazy mqtt, retained frames) ✅
  emulator/index.html           # P0 browser stand-in for the physical orb ✅
firmware/m5-cores3/             # Moddable SDK / TypeScript firmware — scaffolded ✅
  main.ts  net.ts  ui.ts        # glue · wifi+ws / serial · Piu HUD
  manifest.json                 # targets esp32/m5stack_cores3; includes ../../…/{wire,framing}
  moddable.d.ts  tsconfig.json  # editor IntelliSense only
  README.md
```
`@codesense/addon-m5` depends only on `@codesense/core` (types) + `ws`
(+`serialport`, `mqtt` in later phases). **Never** `@codesense/hid`. The
firmware shares `wire.ts` via its manifest — one protocol definition, both sides.

## 10. Phased implementation plan

### P0 — Foundation & emulator (no hardware) — ✅ DONE (2026‑07‑27)
Scaffold `packages/addon-m5`: daemon ws client, `snapshot → HudFrame`,
`Transport` interface, `mockDevice`, and a **browser emulator** that renders
HudFrames and emits DeviceEvents. Freeze the wire protocol.
**Acceptance:** against a live `--mock` daemon, the emulator shows correct state
tint + permission card and can approve‑once / approve‑always / reject / switch
mode / switch session / fire a preset — end‑to‑end, zero hardware.
**Result:** 14 unit tests pass; a headless round trip confirmed device →
bridge → **unmodified daemon** → snapshot → device (daemon log showed
`mode → NAV` and a preset-driven `session 1 ← prompt`). Run it:
`node packages/cli/dist/index.js start --mock --backend sdk` then
`node packages/addon-m5/dist/index.js` and open `http://127.0.0.1:3838/`.
Or with no daemon at all: `node packages/addon-m5/dist/index.js --demo`.

### P1 — WiFi transport + firmware first light
Bridge `wsTransport` (LAN, token). Firmware: connect, render tint + state label,
mode tab strip, three approve buttons, session dots; distinct tones; basic
dim/sleep. `codesense pair` over serial to provision SSID + token.
**Acceptance:** a physical CoreS3 on WiFi mirrors state and approves a real
permission in a live pty session.

### P2 — Serial transport + full standalone controller — ◑ bridge done
`serialTransport` (docked/offline). Preset palette, voice trigger (pty),
interrupt/rewind, IMU gestures (wake/shake/tilt), full audio soundscape,
battery‑aware sleep. Reach standalone parity (drive Claude with no controller).
**Acceptance:** unplug the DualSense; complete a real task from the orb alone,
over both WiFi and serial.
**Landed (host side):** `SerialTransport` (newline‑JSON over USB‑CDC;
`serialport` loaded lazily so the package builds without the native dep),
`--serial <path> --baud <n>` on the bridge CLI, and a shared `framing.ts`
(6 tests). Firmware gained a `SerialLink` selectable via `config.transport`,
sharing `wire.ts` + `framing.ts`. **Still on hardware:** IMU gestures, audio
tones, battery‑aware sleep — those wait for the flash and the Moddable
peripheral‑driver checkpoint (§7).

### P3 — MQTT + OTA + polish — ◑ host side done
`mqttTransport` (fleet/remote). WiFi OTA (signed). `doctor` integration
(detects the bridge + orb), docs/profiles for orb presets, multi‑orb support.
**Landed:** `MqttTransport` (fan-out to any number of orbs via a broker;
retained HudFrames so a fresh orb renders immediately; `mqtt` lazily loaded,
3 topic tests), `--mqtt <url>` / `--mqtt-prefix` on the CLI, and
`codesense-m5 doctor` (daemon reachability + serial-port listing that flags
the Espressif VID `303A`). **Still pending:** signed WiFi OTA and per-profile
orb presets, both of which want the device flashed first.

## 11. Risks & constraints

- **Hardware unproven.** Consistent with the repo's status note (even DualSense
  writes are unverified on hardware). Mitigated by emulator‑first P0.
- **ESP32‑S3 is 2.4 GHz‑only.** Fine for the stated home LAN.
- **Voice is fenced.** Mic triggers Claude Code's `/voice` only, pty‑only; no
  on‑device STT, per CLAUDE.md.
- **LAN security lives in the bridge**, not the daemon; token in the handshake.
- **Snapshot weight.** The bridge computes the slim HudFrame; the MCU never
  parses full snapshots.
- **pty subagent count / cost** aren't in the snapshot today (pty
  `sessions: []`). If we want them on the orb, that's a small, generic daemon
  addition later — not required for v1.

## 12. Open questions (for doc review)
1. ~~Firmware toolchain~~ — **resolved: Moddable SDK (TypeScript)** (see §7).
2. Shake gesture: dismiss‑nudge only, or also reject‑permission (with a guard)?
3. Preset prompt list — which canned prompts ship by default, sourced from the
   profile schema?
4. Tone design per state — who tunes the four/five cues?
5. Emulator home: inside `packages/addon-m5/emulator` (proposed) vs a separate
   package?

## 13. Decision log (2026‑07‑25 interview)
| # | Decision |
|---|---|
| Device role | Full **standalone** controller + status display |
| Backends | **Both** pty + sdk (daemon already abstracts below the action layer) |
| Separation | **Orb totally separated** from the DualSense — addon package + firmware, daemon unchanged |
| Transports | Pluggable, phased: **WiFi → Serial → MQTT** |
| Approve UI | **Three explicit buttons**: once / always / reject |
| Mode switch | **Persistent tab strip** (recommended) |
| Mic | Trigger Claude Code's **`/voice` only** (pty), no on‑device audio |
| Text entry | **Presets + voice**, no on‑screen keyboard |
| Audio | **Distinct tones per state** |
| Gestures | **Pick‑up→wake, shake→dismiss, tilt→scroll** |
| Pairing | **Serial config while docked** |
| Sleep | **Always‑on docked, sleep on battery** |
| OTA | **USB flashing first**, WiFi OTA later |
| Network | Home/trusted LAN, 2.4 GHz solid |
| Firmware | **Moddable SDK (TypeScript)** — language parity + shared protocol types; M5Unified/C++ as a P2 fallback |
