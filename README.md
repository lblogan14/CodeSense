<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.svg">
    <img alt="CodeSense — your DualSense is a command center for Claude Code" src="assets/banner-dark.svg" width="880">
  </picture>
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-windows--first-3E9BFF?style=flat-square">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-2FD48A?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-9D7CFF?style=flat-square">
  <img alt="status" src="https://img.shields.io/badge/status-alpha-FFB020?style=flat-square">
</p>

**CodeSense** turns a stock PS5 DualSense controller into a tactile controller *and* live status display for [Claude Code](https://claude.com/claude-code). Buttons drive the agent; the agent drives the lightbar, player LEDs, haptics, and adaptive triggers back.

A $70 controller you already own has more hardware than a $230 macro pad: RGB lightbar, 5 player LEDs, two sticks, analog triggers with programmable resistance, a 2-point touchpad, haptics, and a gyro. CodeSense uses all of it.

## △ the signature interaction

When Claude asks for permission to run a tool, the lightbar pulses **amber**, the pad double-taps your palms, and **R2 becomes a weighted trigger**:

- **feather the pull** and release → *approve once*
- **pull all the way through the resistance** → *always allow this tool*
- **◯** → reject

Approval stops being a reflexive `y` keystroke and becomes a deliberate physical act — with scope selected by pull depth.

## ◯ what the lightbar tells you

| state | lightbar | haptics |
|---|---|---|
| idle | calm blue, low glow | — |
| thinking / tool running | purple, 2.4 s breathing | — |
| **waiting for you** | amber, double-pulse | double-tap |
| done | green fades, then back to idle | soft pulse |
| error | red flash ×2, then solid | sharp buzz |

Glance at the pad from across the room and know whether your agent needs you. Press **R3** any time to replay the current status as a haptic + LED burst.

## ✕ quickstart

```powershell
# 1. install & build (pnpm monorepo)
pnpm install
pnpm build

# 2. put `codesense` on your PATH (until the npm release) — a shim in any
#    PATH directory works, e.g. the one that already holds claude.exe:
"@echo off`nnode `"$PWD\packages\cli\dist\index.js`" %*" | Out-File -Encoding ascii "$env:USERPROFILE\.local\bin\codesense.cmd"

# 3. wire Claude Code hooks (they feed agent state to the controller)
codesense hooks install

# 4. check your setup — controller plugged in over USB
codesense doctor

# 5. go — from ANY project directory
cd c:\path\to\your\project
codesense start
```

`codesense start` wraps `claude` in a pseudo-terminal: **your normal Claude Code session, unchanged**, except your controller now works — and the pad shows agent state. The web dashboard is served at [`http://localhost:3737`](http://localhost:3737).

No controller handy? `codesense start --mock` gives you a virtual pad in the dashboard.

### multi-session command center

```powershell
node packages/cli/dist/index.js start --backend sdk
```

The SDK backend owns up to **4 Claude sessions** mapped to the player LEDs. **L1/R1** switch the active session, the lightbar tracks the session you're on, and any session that needs permission rumbles the pad — even if it's not the active one. Prompts and transcripts live in the dashboard.

## ▢ default mapping (AGENT mode)

| control | action |
|---|---|
| ✕ cross | accept / approve default |
| ◯ circle | escape / interrupt |
| △ triangle | cycle permission mode (plan / accept-edits) |
| ▢ square | command palette |
| d-pad | menus & history |
| L1 / R1 | previous / next session |
| **R2 (analog)** | **approve permission — pull depth = scope** |
| L2 (hold) | push-to-talk (Claude Code `/voice`) |
| left stick | scroll |
| right stick ↑↓ | reasoning dial (model presets) |
| R3 | replay status (haptic + LED) |
| touchpad swipe → | `/compact` |
| touchpad swipe ← | type `/clear` (✕ to confirm) |
| L1+R1+△ chord | `/clear` — deliberate friction |
| PS | cycle AGENT / NAV / PROMPT modes |
| mute | toggle voice dictation |

Three modes (**AGENT** / **NAV** / **PROMPT**) rebind every control — see the dashboard's mapping explorer, or edit `profiles/default.json` (validated with zod, hot-applied from the dashboard's profile editor).

<p align="center">
  <img alt="CodeSense dashboard" src="docs/assets/dashboard.png" width="820">
</p>

## how it works

```
DualSense ⇄ HID (node-hid) ⇄ codesense daemon (TypeScript)
   ├─ input  → mapping engine (modes · chords · gestures) → keystrokes / actions
   ├─ v1: node-pty wraps `claude` · Claude Code hooks → events.jsonl → state machine
   ├─ v2: Agent SDK sessions · in-process canUseTool → R2 approval
   └─ state → lightbar + player LEDs + haptics + adaptive trigger resistance
                                        ↕
                        web dashboard (ws, localhost:3737)
```

- **`@codesense/hid`** — DualSense protocol: input report parsing, output reports over USB (and Bluetooth behind `--experimental-bt`, with the 0x31 framing + CRC-32 the controller requires), Nielk1-opcode adaptive-trigger effects.
- **`@codesense/core`** — agent state machine, gesture/mapping engine, zod profiles, feedback renderer.
- **`@codesense/backend-pty`** — ConPTY wrapper around `claude`, hooks installer + `events.jsonl` tailer.
- **`@codesense/backend-sdk`** — daemon-owned sessions via `@anthropic-ai/claude-agent-sdk`; permission requests resolve through the controller.
- **`@codesense/cli`** — `codesense start · doctor · hooks · profiles`.
- **`@codesense/dashboard`** — live controller/agent instrumentation (Vite + React, served by the daemon).

More detail in [docs/architecture.md](docs/architecture.md) and [docs/profiles.md](docs/profiles.md).

## troubleshooting

Run `codesense doctor`. The usual suspects:

- **Steam / DS4Windows fighting over the pad** — Windows HID handles are shared; last writer wins on the lightbar. Disable PlayStation support in Steam Input while CodeSense runs.
- **Lightbar never changes** — hooks aren't installed (`codesense hooks install`), or your `claude` session predates the install (restart it).
- **Bluetooth** — supported behind `--experimental-bt`; USB is the blessed path.

## roadmap

- [ ] gyro flick gestures (flick to dismiss notifications)
- [ ] DualSense Edge paddles & function buttons
- [ ] per-project profiles (`.codesense.json`)
- [ ] npm release + prebuilt binaries

## license & trademarks

MIT. CodeSense is a community project, **not affiliated with, endorsed by, or sponsored by Sony Interactive Entertainment or Anthropic**. "DualSense", "PlayStation", and the △◯✕▢ glyphs are trademarks of Sony Interactive Entertainment. "Claude" is a trademark of Anthropic.
