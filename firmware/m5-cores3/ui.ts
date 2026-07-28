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

/** Tap → emit a fixed DeviceEvent (mode tabs, approve buttons, session dots). */
class TapBehavior extends Behavior {
  private event!: DeviceEvent;
  onCreate(_content: object, data: { event: DeviceEvent }): void {
    this.event = data.event;
  }
  onTouchEnded(): void {
    const now = Time.ticks;
    if (now - lastTapTicks < TAP_DEBOUNCE_MS) return;
    lastTapTicks = now;
    trace(`orb: tap ${JSON.stringify(this.event)}\n`);
    send(this.event);
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
  tabs = MODES.map(
    (mode) =>
      new Label({ event: { t: 'mode', mode } } as { event: DeviceEvent }, {
        active: true,
        Behavior: TapBehavior,
        style: styleTab,
        string: mode,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: fill(COLORS.panel),
      }),
  );
  return new Row(null, {
    left: 0,
    right: 0,
    height: 24,
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

  for (let i = 0; i < tabs.length; i++) {
    const on = tabs[i]!.string === frame.mode;
    tabs[i]!.skin = fill(on ? COLORS.accent : COLORS.panel);
  }

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
