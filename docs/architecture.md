# CodeSense architecture

## signal path

```
┌─────────────────────────────────────────────────────────┐
│  DualSense (USB / Bluetooth --experimental-bt)          │
│  input reports ↑↓ output reports (lightbar/LED/haptics) │
└──────────────┬──────────────────────────────────────────┘
               │ HID (node-hid)
┌──────────────▼──────────────────────────────────────────┐
│  codesense daemon (@codesense/cli → Daemon)             │
│  ┌────────────┐ ┌───────────────┐ ┌──────────────────┐  │
│  │ HID layer  │→│ MappingEngine │→│ action handler   │  │
│  │ @codesense │ │ modes, chords │ │ palette, dial,   │  │
│  │ /hid       │ │ gestures, R2  │ │ sessions, macros │  │
│  └─────▲──────┘ └───────────────┘ └────────┬─────────┘  │
│        │        ┌───────────────┐          │            │
│        └────────│FeedbackRender │◄─────────┤            │
│  30 Hz frames   │ lightbar,LEDs,│          │            │
│                 │ haptics,trig. │   AgentStateMachine   │
│                 └───────▲───────┘          │            │
└─────────────────────────┼──────────────────┼────────────┘
             agent events │                  │ keystrokes / decisions
              ┌───────────┴──────────────────▼───────────┐
              │  backends                                │
              │  pty: node-pty wraps `claude` +          │
              │       hooks → events.jsonl → tailer      │
              │  sdk: Agent SDK sessions, canUseTool     │
              └──────────────────────────────────────────┘
                          ↕ ws + http (localhost:3737)
                     @codesense/dashboard
```

## packages

### @codesense/hid

- `protocol.ts` — byte-level DualSense protocol. USB input report `0x01` (64 B), BT `0x31` (78 B, state block shifted +1, CRC-32 checked by the controller). Output: USB `0x02` (48 B); BT `0x31` with the kernel/SDL framing — `seq << 4` in byte 1, `0x10` tag in byte 2, payload at offset 3, CRC-32 over seed `0xA2` + bytes 0–73 stored little-endian at 74–77. Adaptive-trigger effects use the official opcodes (`0x05` off, `0x21` feedback/resistance, `0x25` weapon/section, `0x26` vibration) with Nielk1 parameter encoding.
- `device.ts` — `DeviceManager` hotplug-polls for VID `0x054C` / PID `0x0CE6` (`0x0DF2` Edge), prefers USB, opens the gamepad usage collection. Output writes are on-change coalesced at ≤30 Hz. On a fresh Bluetooth connection the controller sends a 10-byte simplified report until we read feature report `0x05`, which flips it to full `0x31` mode.
- `mock.ts` — `MockDualSense`, the virtual pad used by `--mock` and driven from the dashboard.

### @codesense/core

- `agentState.ts` — state machine over normalized `AgentEvent`s. `done`/`error` decay back to `idle` on timers; nested permission requests are counted.
- `mapping.ts` — `MappingEngine`: edge/hold/chord detection, d-pad & stick repeat, touchpad swipes, and the **analog R2 approval tracker** (arm ≥ 0.4, feathered release → approve *once*, ≥ 0.92 → approve *always*, with a rest-to-rearm cooldown). Buttons that participate in chords defer their solo press ~150 ms so chords don't pre-fire their members.
- `renderer.ts` — pure `(state, time) → FeedbackFrame`: breathing purple, double-pulse amber (brightens as you pull R2), green fade, red flash; haptic patterns per state entry; R2 resistance effect while a permission is pending.
- `profile.ts` — zod schemas for profiles (bindings, chords, palettes, macros).

### @codesense/backend-pty (v1 path)

- `PtySession` wraps `claude` in ConPTY; the host terminal is proxied through, so it *is* your normal Claude Code, plus a controller.
- `hooksInstaller` idempotently merges hook commands into `~/.claude/settings.json` for 11 events (SessionStart/End, UserPromptSubmit, Pre/PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, Stop, StopFailure, Notification). Each hook is a tiny `node -e` script appending the event JSON to `~/.codesense/events.jsonl`.
- `HooksTailer` tails that file (fs.watch + 250 ms polling fallback, torn-write safe) and normalizes events.
- `PtyDispatcher` turns actions into keystrokes: approve-once = Enter, approve-always = ↓ Enter, slash commands are typed with settle delays, the reasoning dial steps through `/model` presets.

### @codesense/backend-sdk (v2 path)

- `SdkSession` — one daemon-owned session using `@anthropic-ai/claude-agent-sdk`'s streaming-input mode; prompts are pushed over the session's lifetime. `canUseTool` blocks until the controller (or dashboard) resolves it; approve-always forwards the SDK's permission `suggestions` as `updatedPermissions`.
- `SessionManager` — 4 slots on the player LEDs, L1/R1 cycling, LED blink for any slot awaiting permission.

### @codesense/cli

`Daemon` wires everything, owns palette/dial state, and exposes ws + static dashboard on `localhost:3737`. `codesense doctor` checks node, the claude CLI, controller presence, HID contention (Steam/DS4Windows), hooks, and the dashboard build.

## decisions & constraints

- **USB first.** BT output framing is implemented (CRC-32 etc.) but gated behind `--experimental-bt` until soak-tested.
- **Hooks over screen scraping.** State comes from Claude Code's own hook events, never from parsing terminal output; slash commands and documented keybindings are preferred over cursor-position tricks.
- **Windows HID is shared.** We can't take exclusive access; `doctor` detects likely contenders instead of fighting them.
- **One output report per change.** Every write carries the full desired state (valid-flag sections are applied absolutely), so the writer caches the last frame and only sends diffs.
