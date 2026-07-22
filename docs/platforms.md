# Platform support

| platform | status | notes |
|---|---|---|
| **Windows 10/11** | ✅ tested daily | primary development platform; ConPTY terminal wrapper |
| **macOS** | 🧪 should work, needs testers | node-hid + node-pty both support macOS; DualSense works over USB out of the box. Voice needs the Claude Code native module (supported). |
| **Linux** | 🧪 should work, needs testers | requires a udev rule for hidraw access — see below |
| **Bluetooth (all)** | 🧪 experimental | `--experimental-bt`; full 0x31 CRC framing implemented, lightly field-tested |

## Linux setup

Without a udev rule, opening the controller needs root. Install ours:

```bash
sudo cp assets/70-codesense-dualsense.rules /etc/udev/rules.d/
sudo udevadm control --reload && sudo udevadm trigger
```

Replug the controller, then `codesense doctor` should show it. If Steam is running, disable PlayStation support in Steam Input settings while CodeSense runs (`ds4drv` conflicts too).

## macOS setup

No special permissions are needed for USB HID. If you use Steam, quit it or disable PlayStation controller support. Everything else (`codesense hooks install`, `codesense start`) works identically — the pty wrapper uses a normal Unix pty instead of ConPTY.

## Agent backends beyond Claude Code

The mapping engine is agent-agnostic — backends provide (1) an input sink (keystrokes) and (2) a state feed (events). Current expansion order, based on hooks-readiness researched July 2026:

1. **GitHub Copilot CLI** — hook payloads intentionally Claude Code-compatible; our tailer ports nearly unchanged
2. **opencode** — rich TypeScript plugin API (25+ lifecycle events)
3. **Cursor CLI** — hooks exist; some events reportedly unreliable in CLI
4. **OpenAI Codex CLI** — only a `notify` completion hook today; input side works fine via pty
5. **Gemini CLI** — deprioritized while Google migrates users to the closed-source Antigravity CLI

Contributions welcome — a backend is one package implementing the `PtySession`-equivalent + event normalizer.
