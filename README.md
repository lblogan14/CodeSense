<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.svg">
    <img alt="CodeSense — turn hardware you own into a command center for Claude Code" src="assets/banner-dark.svg" width="880">
  </picture>
</p>

<p align="center">
  <img alt="npm" src="https://img.shields.io/npm/v/%40binliu14%2Fcode-sense?style=flat-square&color=3E9BFF&label=npm">
  <img alt="windows" src="https://img.shields.io/badge/windows-tested-3E9BFF?style=flat-square">
  <img alt="transport" src="https://img.shields.io/badge/USB%20%2B%20Bluetooth-working-2FD48A?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-FFB020?style=flat-square">
</p>

**CodeSense** turns hardware you already own into a **tactile controller *and* live status display for [Claude Code](https://claude.com/claude-code)**. The agent's state drives lights, haptics, and screens so you *feel* the moment it needs you; your buttons and taps drive the agent back — approve a tool with a squeeze or a tap, talk to it with push‑to‑talk, switch modes, all without breaking flow.

It's built to be **hardware‑agnostic**: one daemon speaks a small, normalized protocol, and each device is a thin, decoupled adapter on top. A PS5 controller and a touchscreen dev kit are the first two — adding a third is writing an adapter, not touching the core.

> OpenAI shipped a **$230 macro pad** (Codex Micro) whose best‑liked trick is a row of RGB keys showing agent status. CodeSense is the open, cross‑platform, terminal‑native answer — and it runs on hardware you probably *already own*, doing things a status‑light macro pad physically can't: force‑feedback approval, a full touch UI, push‑to‑talk.

## pick your hardware

| device | what it gives you | guide |
|---|---|---|
| 🎮 **PS5 DualSense** (~$70, or one you own) | RGB lightbar + 5 player LEDs as agent status, **analog‑trigger approval with programmable resistance**, haptics, sticks, touchpad, push‑to‑talk | **[README‑DUALSENSE.md](README-DUALSENSE.md)** |
| ◐ **M5Stack CoreS3** (~$50 ESP‑S3 kit) | a 2″ **touchscreen status orb** — agent state *is* the screen, with tap‑to‑approve, mode tabs, and hold‑to‑talk on the glass | **[README‑CORES3.md](README-CORES3.md)** |

Both are peers on the same daemon and share none of each other's code — deleting one leaves the other untouched.

## the idea, in one loop

```
        ┌─────────────── your hardware (DualSense · CoreS3 · …) ───────────────┐
input → │  buttons / triggers / touch  →  DeviceEvent  ───────────────┐        │
        └─────────────────────────────────────────────────────────── │ ───────┘
                                                                       ▼
                                                          codesense daemon (TypeScript)
                                                        mapping engine · agent state machine
                                                        pty-wrapped `claude`  OR  Agent SDK
                                                                       │
        ┌───────────────────────────────────────────────────────────── │ ───────┐
output← │  lightbar / LEDs / haptics / triggers / screen  ←  FeedbackFrame        │
        └──────────────────────────────────────────────────────────────────────┘
                                        ↕  web dashboard (ws, localhost:3737)
```

- **State comes from Claude Code hooks, never screen‑scraping.** Hook events → the agent state machine → device feedback.
- **Two backends, one contract.** `pty` wraps your normal `claude` session unchanged; `sdk` owns up to 4 sessions in‑process. Both emit the same events and consume the same actions.
- **Adapters are decoupled.** The DualSense talks byte‑level HID; the CoreS3 is a separate WebSocket client (a bridge + firmware). Neither knows about the other.

## quickstart

Install and wire up Claude Code hooks once:

```powershell
npm install -g @binliu14/code-sense
codesense hooks install
```

Then follow your device's guide:

- **DualSense** → [README‑DUALSENSE.md](README-DUALSENSE.md) — `codesense start`, and the pad comes alive.
- **CoreS3 orb** → [README‑CORES3.md](README-CORES3.md) — flash the firmware, then `pnpm start` + `pnpm orb`.

No hardware yet? `codesense start --mock` gives a virtual DualSense in the dashboard, and the CoreS3 has a browser emulator (`pnpm orb:emulator`).

## how it's built

A pnpm monorepo of TypeScript packages plus a Vite/React dashboard:

- **`@codesense/core`** — no I/O: agent state machine, mapping engine (modes · chords · gestures · analog‑R2 approval), zod profiles, feedback renderer.
- **`@codesense/hid`** — byte‑level DualSense protocol (USB + Bluetooth), hotplug, mock device.
- **`@codesense/backend-pty`** — ConPTY wrapper around `claude` + Claude Code hooks tailer.
- **`@codesense/backend-sdk`** — daemon‑owned sessions via `@anthropic-ai/claude-agent-sdk`; permissions resolve through your hardware.
- **`@codesense/cli`** — the `codesense` command (`start · doctor · test · hooks · profiles`) and the daemon.
- **`@codesense/dashboard`** — live instrumentation served at `localhost:3737`.
- **`@codesense/addon-m5`** + **`firmware/m5-cores3`** — the CoreS3 orb: a decoupled bridge + Moddable/TypeScript firmware.

Architecture and mapping details: [docs/architecture.md](docs/architecture.md) · [docs/profiles.md](docs/profiles.md). Contributor guide: [CLAUDE.md](CLAUDE.md).

## roadmap

Published on npm as [`@binliu14/code-sense`](https://www.npmjs.com/package/@binliu14/code-sense); DualSense USB + Bluetooth verified on hardware, CoreS3 orb live over WiFi.

- [ ] more agent backends: GitHub Copilot CLI, opencode, Codex CLI — see [docs/platforms.md](docs/platforms.md)
- [ ] per‑project profiles (`.codesense.json`), quota/budget gauge
- [ ] more hardware adapters — the whole point of the decoupled design
- [ ] macOS / Linux field testing

Per‑device roadmaps live in [README‑DUALSENSE.md](README-DUALSENSE.md) and [README‑CORES3.md](README-CORES3.md).

## license & trademarks

MIT. CodeSense is a community project, **not affiliated with, endorsed by, or sponsored by Sony Interactive Entertainment, M5Stack, OpenAI, or Anthropic**. "DualSense", "PlayStation", and the △◯✕▢ glyphs are trademarks of Sony Interactive Entertainment. "M5Stack" and "CoreS3" are trademarks of M5Stack. "Claude" is a trademark of Anthropic.
