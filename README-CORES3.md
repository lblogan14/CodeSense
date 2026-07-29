<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.svg">
    <img alt="CodeSense — the CoreS3 orb" src="assets/banner-dark.svg" width="880">
  </picture>
</p>

# CodeSense · M5Stack CoreS3 orb

A stock **M5Stack CoreS3** (a ~$50 ESP32‑S3 kit with a 2″ capacitive‑touch screen) becomes a **glanceable status orb** *and* a **standalone touch controller** for [Claude Code](https://claude.com/claude-code) — a peer of the DualSense that shares none of its code. The agent's state *is* the screen: idle blue → thinking purple → amber "needs you" → done green → error red, and you approve, switch modes, and talk to your agent right on the glass.

> New here? Start with the [main README](README.md) for the concept. This page is the orb deep‑dive. Building the DualSense instead? See [README-DUALSENSE.md](README-DUALSENSE.md).

## a fully decoupled addon

The orb never imports `@codesense/hid` and never modifies the daemon — deleting it leaves the DualSense path untouched. It joins the daemon exactly like the web dashboard does: as an ordinary localhost WebSocket client.

- **`@codesense/addon-m5`** — a **bridge** that connects to the daemon over localhost, turns each daemon snapshot into a slim HUD frame, and maps touch events back onto the same actions the controller uses. Pluggable transports (WiFi / USB‑serial / MQTT). It also serves a browser emulator.
- **`firmware/m5-cores3`** — the orb firmware, also in **TypeScript** (Moddable SDK), sharing the wire types with the bridge so the protocol is defined once.

```
CoreS3 firmware ⇄ WebSocket ⇄ @codesense/addon-m5 bridge ⇄ ws ⇄ codesense daemon
   touch → DeviceEvent → bridge → daemon action (approve / mode / voice / …)
   daemon snapshot → HudFrame → bridge → screen (state color · mode tabs · perm card)
```

## ✕ try it now — no hardware

The browser emulator is a faithful stand‑in for the orb. From this repo (after `pnpm install && pnpm build`):

```powershell
pnpm start --backend sdk    # a daemon on :3737 (or: pnpm dev, for a mock controller)
pnpm orb:emulator           # the bridge + emulator on :3838
# open http://127.0.0.1:3838/  — tap approve/reject, switch modes, fire presets
```

## ◐ on the device — live over WiFi

1. **Flash the firmware.** Full Windows toolchain walkthrough in [firmware/m5-cores3/SETUP.md](firmware/m5-cores3/SETUP.md).
2. **Configure WiFi + bridge host.** Put your 2.4 GHz SSID/password and your PC's LAN IP in the **gitignored** `firmware/m5-cores3/manifest.local.json` (copy `manifest.local.example.json`). WiFi must be 2.4 GHz — the ESP32‑S3 has no 5 GHz radio.
3. **Run the daemon + bridge** (two short commands):

```powershell
pnpm start                  # your Claude session — the daemon on :3737
#   for /voice, use the pty backend:  pnpm start --backend pty
pnpm orb                    # the bridge, bound to the LAN (0.0.0.0:3838)
```

`pnpm orb` is shorthand for the LAN bridge; if you've installed the addon globally it's `codesense-m5 --host 0.0.0.0`. The daemon and bridge are **separate processes on purpose** — the orb stays fully decoupled.

The orb joins WiFi, connects to the bridge, and shows your **live** agent state on the 320×240 screen. It **auto‑reconnects** if WiFi or the bridge blips.

## using the orb

- **State** — the center + top strip show the live agent state (idle/thinking/**amber "needs you"**/done/error), same palette as the DualSense lightbar.
- **Mode tabs** — tap **AGENT / NAV / PROMPT** across the top to switch modes; each lights its own color (blue / teal / violet) and the tap is reflected instantly.
- **Approve on glass** — when Claude asks to run a tool, the card shows the tool + detail and three buttons: **APPROVE** (once) · **ALWAYS** · **REJECT**.
- **🎙 push‑to‑talk** — on the **pty** backend the **HOLD TO TALK** button (bottom) is live: press‑and‑hold to drive Claude Code's own `/voice` dictation (it turns red "● LISTENING" while held), release to submit. There is no on‑device speech‑to‑text — the orb triggers Claude Code's `/voice`, so it's pty‑only (dimmed on the sdk backend).
- **Session dots** — on the sdk backend, the footer dots track up to 4 sessions (active / waiting / idle).

## ⚠ touch calibration (per‑unit)

The Moddable CoreS3 target forwards **raw** FT6x06 coordinates to the UI (its own flip/fit config is never applied by the driver), so on some units touches land scaled/offset from the display — you end up pressing slightly off a control. The fix lives in the SDK target driver, `M5StackCoreS3Touch.js`, whose `sample()` remaps touches into 320×240 display space (see the "CodeSense touch calibration" block there). The correction is **empirically tuned per unit** — if your taps land off, adjust the offset/scale constants in that block. This is a candidate to upstream to Moddable. It can't be corrected from our firmware: the driver class and `mc/config` are both frozen in ROM.

## flashing gotchas

- **The startup chime / scream.** The CoreS3 plays `config.startupSound` on every boot; a boot‑loop can replay it *loudly*. The firmware disables it (`startupSound: ""`) and mutes the amp first thing — but if a build ever screams, stop it with `python -m esptool --chip esp32s3 --port COM3 erase_flash`.
- **After every flash, verify it actually flashed** — a silent `tsc` error leaves the OLD firmware running while the screen looks fine. Confirm both `error TS` == 0 and `Hash of data verified` in the build output.
- **If the orb hangs / won't rejoin**, a hard reset via esptool re‑inits cleanly: `python -m esptool --chip esp32s3 --port COM3 --after hard-reset chip-id`.

Full toolchain, phases, and hard‑won gotchas: [firmware/m5-cores3/SETUP.md](firmware/m5-cores3/SETUP.md). Design + protocol: [docs/addon-m5-cores3.md](docs/addon-m5-cores3.md).

## status & roadmap

Live over WiFi: HUD shows real agent state; on‑screen approve/reject; per‑mode colored tabs; `/voice` push‑to‑talk (pty); WiFi + websocket auto‑reconnect.

- [x] live agent state on the screen
- [x] on‑screen APPROVE / ALWAYS / REJECT
- [x] per‑mode colored tabs + optimistic, instant switching
- [x] `/voice` push‑to‑talk button (pty backend)
- [x] WiFi auto‑reconnect + bridge keepalive
- [ ] USB‑serial transport (CoreS3 USB‑Serial‑JTAG)
- [ ] IMU gestures (BMI270) — pick‑up / shake / tilt
- [ ] audio tones per state (AW88298)
- [ ] preset‑prompt palette on the screen
- [ ] signed WiFi OTA updates
