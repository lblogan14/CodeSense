/**
 * The orb HUD, built with Piu (Moddable's UI framework) for the CoreS3's
 * 320×240 capacitive-touch screen. Mirrors the emulator layout:
 *
 *   ┌──────────────────────────────┐
 *   │ strip (state tint)            │
 *   │ AGENT · NAV · PROMPT   (tabs) │
 *   │        ● STATE / perm card    │
 *   │ ○●○○            🎤 (footer)    │
 *   └──────────────────────────────┘
 *
 * Touch targets emit DeviceEvents through the `send` callback passed to
 * {@link initHud}.
 *
 * ⚠️ P1 scaffold. Piu specifics to confirm at first build: font resources
 * (add to manifest `resources`), Skin color string format, and the touch
 * Behavior method signatures for your SDK version. See README.md.
 */
import { Application, Skin, Style, Label, Content, Column, Row, Container, Behavior } from 'piu/MC';
import Time from 'time';
import type { DeviceEvent, HudFrame, WireMode } from 'wire';

trace('ui: LOADING\n');

const WIDTH = 320;
const HEIGHT = 240;

const COLORS = {
  bg: '#05070b',
  panel: '#12151c',
  ink: '#e8eaf0',
  muted: '#5c6470',
  accent: '#3e9bff',
  once: '#2fd48a',
  reject: '#ff5c5c',
};

const MODES: WireMode[] = ['AGENT', 'NAV', 'PROMPT'];

// Bitmap fonts declared in manifest.json resources (*-alpha). Sizes must match
// the available assets: Regular-16, Regular-20, Semibold-28.
trace('ui: creating styles\n');
const styleState = new Style({ font: '600 28px Open Sans', color: COLORS.ink, horizontal: 'center' });
const styleSub = new Style({ font: '16px Open Sans', color: COLORS.muted, horizontal: 'center' });
const styleTab = new Style({ font: '16px Open Sans', color: COLORS.muted, horizontal: 'center' });
const styleBtn = new Style({ font: '20px Open Sans', color: COLORS.ink, horizontal: 'center' });
trace('ui: styles ok\n');

const skinCache = new Map<string, Skin>();
function fill(hex: string): Skin {
  let s = skinCache.get(hex);
  if (!s) {
    s = new Skin({ fill: hex });
    skinCache.set(hex, s);
  }
  return s;
}

let send: (ev: DeviceEvent) => void = () => undefined;

// Debounce: reject taps that land within TAP_DEBOUNCE_MS of the last accepted
// one — kills FT6x06 touch bounce and back-to-back phantom fires (an important
// guard for the approve/reject buttons).
const TAP_DEBOUNCE_MS = 400;
let lastTapTicks = -TAP_DEBOUNCE_MS;

// Optimistic mode: when a mode tab is tapped we highlight it immediately AND
// "pin" it, so a stale in-flight daemon frame (still carrying the OLD mode)
// can't revert the highlight before the daemon catches up. That revert-then-
// reapply flicker is what still felt laggy after the first optimistic fix.
let pendingMode: string | undefined;
let pendingSince = 0;
const PENDING_MODE_TIMEOUT_MS = 2500;

// The mode currently shown (daemon-confirmed or optimistic). The FT6x06 emits
// phantom touches at rest; re-selecting the mode you're already in just spams
// the daemon and thrashes the link, so we drop those.
let currentMode = 'AGENT';

/** Tap → emit a fixed DeviceEvent (mode tabs, approve buttons, session dots). */
class TapBehavior extends Behavior {
  private event!: DeviceEvent;
  private down = false;
  onCreate(_content: object, data: { event: DeviceEvent }): void {
    this.event = data.event;
  }
  onTouchBegan(_content: Content, _id: number, _x: number, _y: number, _ticks: number): void {
    this.down = true;
  }
  onTouchEnded(_content: Content, _id: number, x: number, y: number, _ticks: number): void {
    // A real tap is a began→ended pair on the same target. A phantom 'ended'
    // with no matching 'began' (FT6x06 noise) is dropped.
    const wasDown = this.down;
    this.down = false;
    if (!wasDown) {
      trace(`orb: phantom-end @${x},${y}\n`);
      return;
    }
    const now = Time.ticks;
    if (now - lastTapTicks < TAP_DEBOUNCE_MS) return;
    // Drop redundant re-selection of the mode we're already in (phantom guard).
    if (this.event.t === 'mode' && this.event.mode === currentMode) return;
    lastTapTicks = now;
    if (this.event.t === 'mode') {
      currentMode = this.event.mode;
      pendingMode = this.event.mode;
      pendingSince = now;
      highlightTabs(this.event.mode); // instant, and pinned until the daemon confirms
    }
    trace(`orb: tap ${JSON.stringify(this.event)} @${x},${y}\n`);
    send(this.event);
  }
}

// Distinct color per mode so the selected tab tells you which mode you're in at
// a glance. (On the DualSense, mode is signaled by player-LED flash count —
// AGENT=1, NAV=2, PROMPT=3; the orb uses hue instead.)
const MODE_TAB_COLOR: Record<string, string> = {
  AGENT: '#3e9bff', // blue
  NAV: '#22c3a6', // teal
  PROMPT: '#c07cff', // violet
};

/** Highlight the active mode tab in its mode color. Used by render() + on tap. */
function highlightTabs(mode: string): void {
  for (let i = 0; i < tabs.length; i++) {
    const label = tabs[i]!;
    const on = label.string === mode;
    label.skin = fill(on ? (MODE_TAB_COLOR[label.string] ?? COLORS.accent) : COLORS.panel);
  }
}

/** Push-to-talk: press = pushStart, release = pushEnd. */
class MicBehavior extends Behavior {
  onTouchBegan(): void {
    send({ t: 'voice', phase: 'pushStart' });
  }
  onTouchEnded(): void {
    send({ t: 'voice', phase: 'pushEnd' });
  }
}

// (No whole-screen touch handler: the FT6x06 reports phantom touches at rest,
// so only the specific buttons below — tabs, approve/reject, dots, mic — are
// active touch targets. That avoids flooding the bridge with phantom gestures.)

// ── content refs updated by render() ────────────────────────────
let strip: Content;
let centerBox: Container;
let tabs: Label[] = [];
let dots: Row;
let mic: Label;

function buildTabs(): Row {
  // Explicit full-width cells so the whole third of the screen is the touch
  // target — a bare Label sizes to its text (~50px), which was too small to hit.
  const tabW = Math.floor(WIDTH / MODES.length);
  tabs = MODES.map(
    (mode) =>
      new Label({ event: { t: 'mode', mode } } as { event: DeviceEvent }, {
        active: true,
        Behavior: TapBehavior,
        style: styleBtn,
        string: mode,
        width: tabW,
        height: 46,
        skin: fill(COLORS.panel),
      }),
  );
  return new Row(null, {
    left: 0,
    right: 0,
    height: 46,
    contents: tabs,
  });
}

function buildCenter(): Container {
  // Swappable center: state view OR permission view (with approve/reject).
  // render() → renderCenter() rebuilds its contents on each frame.
  centerBox = new Container(null, { left: 0, right: 0, top: 0, bottom: 0, contents: [] });
  return centerBox;
}

/** An approve/reject touch button carrying its DeviceEvent. */
function actionButton(label: string, color: string, ev: DeviceEvent): Label {
  return new Label({ event: ev } as { event: DeviceEvent }, {
    active: true,
    Behavior: TapBehavior,
    style: styleTab,
    string: label,
    top: 2,
    bottom: 2,
    left: 2,
    right: 2,
    skin: fill(color),
  });
}

function buildFooter(): Row {
  dots = new Row(null, { left: 8, height: 24, contents: [] });
  mic = new Label(null, {
    active: true,
    Behavior: MicBehavior,
    style: styleTab,
    string: 'mic',
    right: 8,
    width: 40,
    height: 24,
  });
  return new Row(null, {
    left: 0,
    right: 0,
    height: 24,
    contents: [dots, new Content(null, { left: 0, right: 0 }), mic],
  });
}

/** Create the Application and return it (main.ts sets it as the default export). */
export function initHud(onEvent: (ev: DeviceEvent) => void): Application {
  send = onEvent;
  trace('ui: initHud\n');

  strip = new Content(null, { left: 0, right: 0, top: 0, height: 4, skin: fill(COLORS.muted) });
  trace('ui: strip ok\n');
  const tabsRow = buildTabs();
  trace('ui: tabs ok\n');
  const centerCol = buildCenter();
  trace('ui: center ok\n');
  const footerRow = buildFooter();
  trace('ui: footer ok\n');

  trace('ui: application...\n');
  const app = new Application(null, {
    displayListLength: 8192,
    commandListLength: 4096,
    touchCount: 1,
    skin: fill(COLORS.bg),
    style: styleSub,
    contents: [
      new Column(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        contents: [strip, tabsRow, centerCol, footerRow],
      }),
    ],
  });
  trace('ui: application ok\n');

  return app;
}

/** Render the latest frame. Called on every HudFrame from the bridge. */
export function render(frame: HudFrame): void {
  strip.skin = fill(frame.hex);

  // Honor an optimistic pending mode until the daemon confirms it (or we time
  // out), so a stale in-flight frame can't flicker the highlight back.
  let shownMode: string = frame.mode;
  if (pendingMode !== undefined) {
    if (frame.mode === pendingMode || Time.ticks - pendingSince > PENDING_MODE_TIMEOUT_MS) {
      pendingMode = undefined;
    } else {
      shownMode = pendingMode;
    }
  }
  highlightTabs(shownMode);
  currentMode = shownMode; // keep the phantom-guard in sync with what's shown

  renderCenter(frame);
  renderDots(frame);
  mic.state = frame.backend === 'pty' ? 1 : 0; // dim when mic is unavailable
}

/** Rebuild the center: a permission prompt (with approve/reject) or the state. */
function renderCenter(frame: HudFrame): void {
  centerBox.empty();
  if (frame.perm) {
    const tool = new Label(null, {
      style: styleState,
      string: (frame.perm.tool ?? 'TOOL').toUpperCase(),
      left: 0, right: 0, height: 30,
    });
    const detail = new Label(null, {
      style: styleSub,
      string: frame.perm.detail ?? '',
      left: 0, right: 0, height: 18,
    });
    const buttons = new Row(null, {
      left: 4, right: 4, height: 40,
      contents: [
        actionButton('APPROVE', '#2fd48a', { t: 'approve', scope: 'once' }),
        actionButton('ALWAYS', '#3e9bff', { t: 'approve', scope: 'always' }),
        actionButton('REJECT', '#ff5c5c', { t: 'reject' }),
      ],
    });
    centerBox.add(
      new Column(null, { left: 0, right: 0, top: 0, bottom: 0, contents: [tool, detail, buttons] }),
    );
  } else {
    centerBox.add(
      new Column(null, {
        left: 0, right: 0, top: 0, bottom: 0,
        contents: [
          new Label(null, { style: styleState, string: frame.state.toUpperCase(), left: 0, right: 0 }),
          new Label(null, { style: styleSub, string: subFor(frame.state), left: 0, right: 0 }),
        ],
      }),
    );
  }
}

function renderDots(frame: HudFrame): void {
  dots.empty();
  for (const s of frame.sessions) {
    const color = s.active ? COLORS.accent : s.waiting ? '#ffb020' : COLORS.muted;
    dots.add(
      new Content({ event: { t: 'session', target: s.slot } } as { event: DeviceEvent }, {
        active: true,
        Behavior: TapBehavior,
        width: 12,
        height: 12,
        skin: fill(color),
        left: 3,
        right: 3,
      }),
    );
  }
}

function subFor(state: string): string {
  switch (state) {
    case 'idle':
      return 'ready';
    case 'thinking':
      return 'working…';
    case 'done':
      return 'finished';
    case 'error':
      return 'tool failed';
    case 'disconnected':
      return 'no backend';
    default:
      return '';
  }
}
