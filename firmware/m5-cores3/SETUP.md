# CoreS3 orb — hardware setup & the P1–P3 tasks (Windows)

A step-by-step guide to take the orb from "code only" to "running on the
device." Everything here is the hardware/toolchain work that can't be done from
the repo alone. Assumes the CoreS3 is on **COM3** (Espressif `303A:1001`,
confirmed via Device Manager → Ports).

**Mental model.** You install two things: **ESP-IDF** (Espressif's C toolchain
for the chip) and the **Moddable SDK** (the JavaScript runtime + build tools
that sit on top of it). Then the whole loop is:

```
edit TS  →  mcconfig -d -m -p esp32/m5stack_cores3  →  builds + flashes COM3  →  app runs  →  xsbug shows traces
```

`mcconfig` is the build+flash command; `-d` = debug (connects the `xsbug`
debugger), `-m` = make. Version-sensitive details (VS/IDF versions) change with
releases — the two official pages are the source of truth:
- Install: <https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/Moddable%20SDK%20-%20Getting%20Started.md>
- ESP32: <https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/devices/esp32.md>

---

## P1 — First light

### 1. C/C++ build tools
Install **Visual Studio (Community) with the "Desktop development with C++"
workload** (Build Tools alone also work). This provides the compiler Moddable's
tools build with.

### 2. Install the Moddable SDK
```bat
cd %USERPROFILE%\Projects            :: create the folder if needed
git clone https://github.com/Moddable-OpenSource/moddable
```
Set a **user environment variable** `MODDABLE = %USERPROFILE%\Projects\moddable`
and add `%MODDABLE%\build\bin\win\release` to your `Path` (Control Panel →
Environment Variables). Open a **new** "x86 Native Tools Command Prompt for VS",
then build the tools:
```bat
cd %MODDABLE%\build\makefiles\win
build
```
Verify on the desktop simulator (no device needed):
```bat
cd %MODDABLE%\examples\helloworld
mcconfig -d -m -p win
```
`xsbug` (the debugger) should open and print "hello, world".

### 3. Install ESP-IDF (the version Moddable pins — currently v6.0)
Run the **Espressif ESP-IDF Windows Installer**, or clone manually:
```bat
cd %USERPROFILE%\esp32
git clone -b v6.0 --recursive https://github.com/espressif/esp-idf.git
```
Set user variable `IDF_PATH = %USERPROFILE%\esp32\esp-idf`, then:
```bat
cd %IDF_PATH%
install.bat
```
> **CoreS3 note:** it uses the ESP32-S3's **native USB** — you do **not** need
> the CP210x driver that generic ESP32 guides mention. It already enumerates as
> COM3.

Tell Moddable which port to flash (user variable):
```
UPLOAD_PORT = COM3
```

### 4. Prove the toolchain on the device
Flash a stock Moddable example to the CoreS3 first — this isolates
"toolchain works" from "our code works":
```bat
cd %MODDABLE%\examples\piu\balls
mcconfig -d -m -p esp32/m5stack_cores3
```
You should see bouncing balls on the orb and traces in `xsbug`. If this works,
the hard part is done.

### 5. Configure our firmware
WiFi + bridge host go in **`manifest.local.json`** (gitignored — never
committed). Create it from the template and fill it in:
```bash
cp manifest.local.example.json manifest.local.json
```
```jsonc
// manifest.local.json
"wifi":   { "ssid": "<your 2.4GHz SSID>", "password": "<pass>" },
"bridge": { "host": "<your PC LAN IP>", "port": 3838, "token": "" }
```
Find your PC's LAN IP with `ipconfig` (the IPv4 on the adapter that shares the
orb's network).
> WiFi must be **2.4 GHz** — the ESP32-S3 has no 5 GHz radio.

### 6. Start the daemon + bridge on the PC (LAN-visible)
```powershell
# terminal 1 — a daemon (your real one, or a mock for testing)
node packages/cli/dist/index.js start --mock --backend sdk
# terminal 2 — the bridge, bound to the LAN so the orb can reach it
node packages/addon-m5/dist/index.js --host 0.0.0.0
```
If Windows Firewall prompts, **allow** Node on private networks (the orb must
reach port 3838). Sanity-check first with `node packages/addon-m5/dist/index.js doctor`.

### 7. Build + flash our firmware
```bat
cd %USERPROFILE%\...\CodeSense\firmware\m5-cores3
mcconfig -d -m -p esp32/m5stack_cores3
```

### 8. First light ✅
The screen should mirror the agent state (idle blue → thinking purple → amber
on a permission), and tapping the **AGENT/NAV/PROMPT** tabs should round-trip —
watch the bridge and daemon logs for `mode → …`.

### P1 troubleshooting
| Symptom | Fix |
|---|---|
| First build errors on a **font/resource** | Expected — the scaffold references `Open Sans`; add a font to the manifest `resources` (see any `$MODDABLE/examples/piu/*` manifest) or switch to a bundled one. This is the first P2 task below. |
| Flash can't find the port | Confirm `UPLOAD_PORT=COM3`; close anything holding COM3 (Arduino/serial monitors). |
| Orb never connects | PC and orb on the **same 2.4 GHz** network; `bridge.host` = PC's LAN IP; bridge started with `--host 0.0.0.0`; firewall allows port 3838. |
| Build can't find `mcconfig` | Reopen the VS Native Tools prompt after setting `Path`; confirm `echo %MODDABLE%`. |
| Build fails on `tsc` | Moddable transpiles `.ts` via `tsc` — `npm install -g typescript` and ensure `%APPDATA%\npm` is on PATH. |
| **Speaker screams / loud tone** | The CoreS3 target plays `config.startupSound` on every boot; a **boot-loop replays it**. `manifest.json` sets `startupSound: ""` to disable it, and `main.ts` mutes `globalThis.amp` (AW88298) first thing. If you hit it: `python -m esptool --chip esp32s3 --port COM3 erase_flash`. |

---

## Bring-up status (2026-07-28) — LIVE over WiFi ✅

**Working & verified on hardware:**
- Full toolchain (VS Build Tools, Moddable SDK, ESP-IDF v6.0, esp32s3, `tsc`).
- Flashing over COM3 (Moddable `balls` example ran; our firmware flashes).
- **The full HUD runs on-device** — state strip, AGENT/NAV/PROMPT tabs, the
  state/permission view with APPROVE/ALWAYS/REJECT buttons, dots, mic. Fonts
  (OpenSans 16/20/28) render. Touch works (with a 400ms tap debounce).
- **Live over WiFi.** `transport:"wifi"` (default): the orb joins WiFi via
  Moddable's `setup/network` (top-level `ssid`/`password`), connects the
  WebSocket to the bridge (`bridge.host:port`), renders live agent state, and
  sends taps (approve/reject/mode) back to the daemon. Verified: bridge logs
  `device connected · dev1`.
- `config.transport` also supports `"demo"` (on-device state cycle, no host).
- The `@codesense/addon-m5` **bridge + emulator** work end-to-end on the PC.

**Go live:** put `transport:"wifi"` + top-level `ssid`/`password` + `bridge.host`
(PC LAN IP) in the gitignored `manifest.local.json`, flash, then on the PC run
`node packages/cli/dist/index.js start` **and**
`node packages/addon-m5/dist/index.js --host 0.0.0.0`.

### Two hard-won gotchas
1. **`BridgeLink` must be WebSocket-only.** It must NOT `import WiFi from "wifi"`
   (legacy) — Moddable's `setup/network` already associates WiFi with the
   ECMA-419 driver. Loading both WiFi drivers → deterministic `esp_restart` at
   XS module-graph prepare (before any code; no console abort — it's on the
   xsbug channel). Let `setup/network` own WiFi; the link just retries the ws.
2. **After every flash, verify the build actually flashed** — `grep 'error TS'`
   == 0 AND `Hash of data verified` present. A silent `tsc` failure leaves the
   OLD firmware running while the screen looks fine (this cost hours).

### ⚠️ Gotcha that cost us: do not name a module `net`
Our device-link module was originally `net.ts` → module **`net`**, which is a
**preloaded Moddable builtin** (network info, `modules/network/net`, pulled in by
`manifest_base`). Two modules compiling to `net.xsb` produced a silent
`NMAKE : warning U4004: too many rules for target …net.xsb`, and at runtime
`import … from 'net'` resolved to the wrong module → XS **aborted at module-graph

### ⚠️ Gotcha that cost us: do not name a module `net`
Our device-link module was originally `net.ts` → module **`net`**, which is a
**preloaded Moddable builtin** (network info, `modules/network/net`, pulled in by
`manifest_base`). Two modules compiling to `net.xsb` produced a silent
`NMAKE : warning U4004: too many rules for target …net.xsb`, and at runtime
`import … from 'net'` resolved to the wrong module → XS **aborted at module-graph
prepare time** (deterministic `esp_restart`, before any code ran, no C
backtrace). Symptom: importing `ui` alone worked, but adding the link module
killed it. **Fix:** renamed it to **`links.ts`** (module `links`). Avoid other
builtin names too (`net`, `timer`, `wifi`, `websocket`, `socket`, `mqtt`, …).

> Tip: `fxAbort` prints `XS abort: <reason>` to the console (xsPlatform.c). A
> plain `pyserial` read of COM3 at 115200 (USB-CDC ignores baud) catches it —
> and watch the build log for `too many rules for target` name collisions.

---

## P2 — On-device features (code in our firmware, then rebuild each time)

Iterate with `mcconfig -d -m -p esp32/m5stack_cores3` after each edit.

1. **Fonts (do this first).** Add a font resource to `manifest.json`
   (`"resources": { "*": [ "$(MODDABLE)/examples/assets/fonts/OpenSans-Regular-20" ] }`
   style) and reference its name in `ui.ts`'s `Style` objects.
2. **Approve buttons.** In [`ui.ts`](ui.ts) `render()`, the permission branch
   currently shows the request text. Add three tap targets using the existing
   `TapBehavior` with events `{t:'approve',scope:'once'}`,
   `{t:'approve',scope:'always'}`, `{t:'reject'}` — the events and the bridge
   mapping already exist, so this is pure UI.
3. **IMU gestures (BMI270).** Read the accelerometer via Moddable's I²C /
   sensor API, detect pick-up / shake / tilt, and emit `{t:'gesture',name:…}`.
   ⚠️ Checkpoint: confirm Moddable's CoreS3 target exposes the BMI270; if not,
   write a small I²C driver or fall back (see design doc §7).
4. **Audio tones (AW88298).** Play a short tone per state on `needsYou` /
   error / done using Moddable's audio out. Same driver-coverage checkpoint.
5. **Battery + sleep (AXP2101).** Read battery level; dim then light-sleep on
   battery, full brightness on USB; wake on touch/IMU.
6. **Serial transport.** Set `config.transport = "serial"` and confirm the
   `SerialLink` in [`net.ts`](net.ts) against Moddable's serial IO for the
   CoreS3's USB-CDC. On the PC, run the bridge with `--serial COM3`.

---

## P3 — MQTT (device), OTA, presets

1. **MQTT on the device.** The firmware today speaks ws + serial; add an
   `MqttLink` (Moddable has an `mqtt` module) implementing the same `Link`
   interface. On the PC run a broker (e.g. Mosquitto) and the bridge with
   `--mqtt mqtt://<pc-ip>:1883`. Good for a fleet or away-from-desk.
2. **WiFi OTA.** Use Moddable's OTA support (`mcconfig -t ota` builds an update
   image; see `$MODDABLE/examples/network/mdns`/OTA docs). Sign updates so the
   orb only accepts trusted images. Lets you update without re-cabling.
3. **Presets from the profile.** The bridge currently ships `DEFAULT_PRESETS`
   in `index.ts`; wire these to your CodeSense profile so preset prompts are
   configurable per user, and they'll flow to the orb in the HudFrame.

---

## Everyday loop after setup

```bat
:: edit firmware TS, then:
cd firmware\m5-cores3
mcconfig -d -m -p esp32/m5stack_cores3     :: rebuild + reflash + xsbug traces
```
Keep the PC-side daemon + bridge running; you only reflash the orb when you
change firmware. Change WiFi/bridge config any time by editing `manifest.json`
and reflashing.
