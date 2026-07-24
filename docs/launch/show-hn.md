# Show HN launch kit

## Title (pick one — HN titles can't be edited after posting)

**Preferred:**
> Show HN: CodeSense – Drive Claude Code with a PS5 controller (open source)

**Alternates:**
> Show HN: I turned my PS5 DualSense into a status display and controller for Claude Code
> Show HN: A $70 DualSense does what OpenAI's $230 Codex Micro does, for Claude Code

Keep it factual — HN mods penalize hype. Lead with what it is, not a superlative.

## Post body

CodeSense is an open-source daemon that turns a stock PS5 DualSense controller into a
two-way control surface for Claude Code. It's bidirectional, which is the part I
haven't seen elsewhere: the controller drives the agent (buttons → keystrokes and
slash-commands through a pty), and the agent drives the controller back — the lightbar
shows agent state (blue idle, purple thinking, amber "waiting for you", green done, red
error), fed by Claude Code's own hook events rather than screen-scraping.

The interaction I'm most happy with is permission approval on the analog R2 trigger.
When Claude asks to run a tool, R2 becomes a weighted trigger with adaptive-trigger
resistance: feather the pull to approve once, pull all the way through the resistance to
"always allow", ◯ to reject. Destructive-looking commands (rm -rf, force-push,
reset --hard) get a sharper haptic so a risky approval physically feels different from a
routine one. Approval stops being a reflexive `y`.

Other bits: hold L2 for push-to-talk into Claude Code's /voice; a right-stick "reasoning
dial" that steps /effort and shows the level as lightbar brightness; hold-◯ opens the
checkpoint/rewind menu; a radial menu on R3 + stick flick; player LEDs count live
subagents; and a live web dashboard (served by the daemon) that mirrors the pad and lets
you edit the mapping profile.

Stack: TypeScript monorepo, node-hid for the DualSense HID protocol (USB solid; Bluetooth
with the 0x31 + CRC-32 framing behind a flag), node-pty (ConPTY on Windows) wrapping the
`claude` CLI, and the Claude Agent SDK for a multi-session backend. Windows-first because
that's what I use and the existing gamepad projects are macOS-only; macOS/Linux are
implemented but need testers.

It's MIT, works with the controller already in your drawer, and I wrote the whole DualSense
output path (lightbar/LEDs/rumble/adaptive triggers) against the cross-checked Linux
kernel + SDL + pydualsense sources — happy to talk about the HID protocol traps
(Bluetooth CRC, active-low touch flag, the two incompatible 0x31 framings) in the comments.

Repo: https://github.com/lblogan14/CodeSense

## First-comment seed (post immediately after, adds context without cluttering the title)

Some things I learned building it:
- Claude Code's hook system is the right way to get agent state — it's a state machine and
  the hooks fire deterministically, so the lightbar changes the instant a permission is
  requested instead of on a timer.
- ConPTY doesn't search PATH, so spawning `claude` needs manual PATH+PATHEXT resolution.
- The DualSense Bluetooth output report is silently dropped if the CRC-32 is wrong (seed
  byte 0xA2, covers the report ID). That one cost me an afternoon.
Happy to answer anything.

## Posting checklist
- [ ] npm publish landed (`npm view @binliu14/code-sense version`) so `npm i -g @binliu14/code-sense` works
- [ ] demo.gif renders at top of README on GitHub
- [ ] repo description + topics set
- [ ] post from an aged account (HN throttles new accounts on Show HN)
- [ ] post Tue–Thu ~9-11am ET; reply to every comment for the first 2 hours
- [ ] cross-post to r/ClaudeAI and r/ClaudeCode (where the audience/pain lives)
