# CodeSense profiles

A profile is a JSON file mapping controller gestures to actions, per mode. The default lives at `profiles/default.json`; put personal ones in `~/.codesense/profiles/` and pass `--profile <file>`, or edit live in the dashboard (validated + hot-applied + saved).

## shape

```jsonc
{
  "name": "my-profile",
  "options": {
    "stickDeadzone": 0.18,
    "holdMs": 450,            // press-and-hold threshold
    "swipeThreshold": 220,    // touchpad px
    "approveArm": 0.4,        // R2: pull depth that arms approval
    "approveFull": 0.92,      // R2: full pull = approve always
    "approveRelease": 0.15    // R2: release below this = approve once
  },
  "modes": {
    "AGENT":  { "bindings": { /* gesture → binding */ } },
    "NAV":    { "bindings": { } },
    "PROMPT": { "bindings": { } }
  },
  "chords":   [ { "buttons": ["l1","r1","triangle"], "action": { "type": "slash", "command": "/clear" }, "mode": "*" } ],
  "palettes": { "commands": [ { "label": "…", "action": { } } ] },
  "macros":   { "type-clear": [ { "type": "text", "text": "/clear" } ] }
}
```

## gestures

- `cross.press` / `cross.release` / `cross.hold` — every button: `cross circle square triangle dpadUp dpadDown dpadLeft dpadRight l1 r1 l2 r2 l3 r3 create options ps touchpad mute`
- `touchpad.swipeLeft|swipeRight|swipeUp|swipeDown`
- `lstick.up|down|left|right`, `rstick.up|down|left|right` — fire once, then repeat while deflected
- `r2.pull` / `l2.pull` — reserved for analog tracking (R2 approval is built in and takes over R2 whenever a permission is pending)

Buttons used in any chord wait ~150 ms before firing their solo binding, so chords never trigger their members.

## actions

| type | fields | meaning |
|---|---|---|
| `keys` | `keys` | raw bytes to the terminal — escape sequences as `\u001b[A` etc. |
| `text` | `text` | typed literally (in sdk mode: becomes a prompt) |
| `slash` | `command` | Esc, type the command, Enter — e.g. `/compact` |
| `mode` | `mode` (`AGENT`/`NAV`/`PROMPT`/`next`) | switch mapping mode |
| `session` | `target` (`next`/`prev`/1–4) | switch active SDK session |
| `approve` | `scope` (`once`/`always`) | resolve the pending permission |
| `reject` | — | reject the pending permission |
| `interrupt` | — | Esc |
| `dial` | `direction` | step the reasoning dial (`/model` presets) |
| `palette` | `palette` | open a named palette (d-pad + ✕ to pick) |
| `macro` | `id` | run a sequence from `macros` |
| `voice` | `action` (`toggle`/`push`/`pushStart`/`pushEnd`) | `toggle` runs `/voice`; `pushStart`/`pushEnd` on press/release stream key-repeat Space for hold-mode push-to-talk; `push` is a single tap-mode Space |
| `rewind` | — | Esc · Esc — opens the checkpoint menu (input must be empty) |
| `replay-status` | — | haptic + lightbar replay of current state |
| `noop` | — | placeholder |

Two engine behaviors worth knowing: a button with a `.hold` binding fires its `.press` on release instead (tap vs hold never double-fires), and `options.dialCommands` (default `/effort low → max`) is what the reasoning dial steps through — the lightbar brightness flashes to show the level.

## useful key escapes

| key | JSON string |
|---|---|
| Enter | `"\r"` |
| Esc | `"\u001b"` |
| Tab / Shift+Tab | `"\t"` / `"\u001b[Z"` |
| arrows ↑ ↓ → ← | `"\u001b[A"` `"\u001b[B"` `"\u001b[C"` `"\u001b[D"` |
| PageUp / PageDown | `"\u001b[5~"` / `"\u001b[6~"` |
| Ctrl+O (transcript) | `"\u000f"` |
| Ctrl+R (history search) | `"\u0012"` |
| Ctrl+L (redraw) | `"\f"` |

Validate any profile with `codesense profiles validate <file>`.
