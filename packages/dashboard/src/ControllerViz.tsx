import type { DaemonSnapshot } from './types';

export interface ControllerVizProps {
  snapshot: DaemonSnapshot | null;
  selected: string;
  onSelect: (control: string) => void;
  send: (msg: Record<string, unknown>) => void;
}

const FACE = {
  cross: '#5D9CEC',
  circle: '#ED5565',
  triangle: '#48CFAD',
  square: '#EC87C0',
};

/** Interactive DualSense: live input state in, lightbar/LED feedback out. */
export function ControllerViz({ snapshot, selected, onSelect, send }: ControllerVizProps) {
  const c = snapshot?.controller;
  const f = snapshot?.feedback;
  const buttons = c?.buttons ?? {};
  const lb = f
    ? `rgb(${Math.max(f.lightbar.r, 10)}, ${Math.max(f.lightbar.g, 12)}, ${Math.max(f.lightbar.b, 18)})`
    : '#1a1e27';
  const lbIntensity = f
    ? Math.min(1, (f.lightbar.r + f.lightbar.g + f.lightbar.b) / 300)
    : 0;

  const pick = (id: string, simButton?: string): void => {
    onSelect(id);
    if (simButton) send({ type: 'sim-tap', button: simButton });
  };

  const cls = (id: string, buttonName?: string): string =>
    [
      'hit',
      selected === id ? 'sel' : '',
      buttonName && buttons[buttonName] ? 'pressed' : '',
    ].join(' ');

  const stickOffset = (s?: { x: number; y: number }) => ({
    dx: (s?.x ?? 0) * 7,
    dy: (s?.y ?? 0) * 7,
  });
  const ls = stickOffset(c?.sticks.left);
  const rs = stickOffset(c?.sticks.right);
  const touch = c?.touchpad.points[0];

  const selStroke = (id: string) => (selected === id ? '#E8EAF0' : 'transparent');

  return (
    <div className="controller-wrap">
      <div
        className="controller-glow"
        style={{
          background: `radial-gradient(ellipse 55% 42% at 50% 28%, ${lb}33, transparent 70%)`,
          opacity: 0.4 + lbIntensity * 0.6,
        }}
      />
      <svg viewBox="0 0 400 268" style={{ width: '100%', display: 'block', position: 'relative' }}>
        {/* triggers with analog fill */}
        <g className={cls('l2', 'l2')} onClick={() => pick('l2', 'l2')}>
          <rect className="shape" x="72" y="6" width="52" height="16" rx="8" fill="#262A35" />
          <rect
            x="72" y="6" height="16" rx="8"
            width={Math.max(0, (c?.triggers.l2 ?? 0) * 52)}
            fill="#3E9BFF" opacity="0.55"
          />
          <rect x="72" y="6" width="52" height="16" rx="8" fill="none" stroke={selStroke('l2')} strokeWidth="1.4" />
          <text x="98" y="17" textAnchor="middle" fontSize="9" fill="#9AA3B2" className="mono">L2</text>
        </g>
        <g className={cls('r2', 'r2')} onClick={() => pick('r2', 'r2')}>
          <rect className="shape" x="276" y="6" width="52" height="16" rx="8" fill="#262A35" />
          <rect
            x="276" y="6" height="16" rx="8"
            width={Math.max(0, (c?.triggers.r2 ?? 0) * 52)}
            fill={snapshot?.agentState === 'permission' ? '#FFB020' : '#3E9BFF'}
            opacity="0.65"
          />
          <rect x="276" y="6" width="52" height="16" rx="8" fill="none" stroke={selStroke('r2')} strokeWidth="1.4" />
          <text x="302" y="17" textAnchor="middle" fontSize="9" fill="#9AA3B2" className="mono">R2</text>
        </g>
        <g className={cls('l1', 'l1')} onClick={() => pick('l1', 'l1')}>
          <rect className="shape" x="66" y="26" width="64" height="12" rx="6" fill="#2B2F3B" stroke={selStroke('l1')} />
          <text x="98" y="35" textAnchor="middle" fontSize="8" fill="#9AA3B2" className="mono">L1</text>
        </g>
        <g className={cls('r1', 'r1')} onClick={() => pick('r1', 'r1')}>
          <rect className="shape" x="270" y="26" width="64" height="12" rx="6" fill="#2B2F3B" stroke={selStroke('r1')} />
          <text x="302" y="35" textAnchor="middle" fontSize="8" fill="#9AA3B2" className="mono">R1</text>
        </g>

        {/* body */}
        <path
          d="M 96 44 C 130 36, 270 36, 304 44 C 348 52, 366 92, 372 138 C 378 182, 366 218, 340 224 C 316 229, 296 208, 282 186 C 270 168, 254 160, 200 160 C 146 160, 130 168, 118 186 C 104 208, 84 229, 60 224 C 34 218, 22 182, 28 138 C 34 92, 52 52, 96 44 Z"
          fill="#171922"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1.5"
        />

        {/* lightbar arcs around the touchpad */}
        <g className={cls('lightbar')} onClick={() => pick('lightbar')}>
          <path d="M 156 50 C 150 58, 147 72, 148 84" fill="none" stroke={lb} strokeWidth="5" strokeLinecap="round" />
          <path d="M 244 50 C 250 58, 253 72, 252 84" fill="none" stroke={lb} strokeWidth="5" strokeLinecap="round" />
        </g>

        {/* touchpad */}
        <g className={cls('touchpad', 'touchpad')} onClick={() => pick('touchpad', 'touchpad')}>
          <rect className="shape" x="156" y="50" width="88" height="40" rx="9" fill="#20242E" stroke={selected === 'touchpad' ? '#E8EAF0' : 'rgba(255,255,255,0.08)'} />
          {touch?.active && (
            <circle
              cx={156 + (touch.x / 1920) * 88}
              cy={50 + (touch.y / 1080) * 40}
              r="4"
              fill="#3E9BFF"
              opacity="0.9"
            />
          )}
        </g>

        {/* player LEDs from feedback bitmask */}
        {[0, 1, 2, 3, 4].map((i) => (
          <circle
            key={i}
            cx={186 + i * 7}
            cy={96}
            r="1.8"
            fill={f && f.playerLeds & (1 << i) ? '#E8EAF0' : '#3A3F4D'}
          />
        ))}

        {/* create / options */}
        <g className={cls('create', 'create')} onClick={() => pick('create', 'create')}>
          <rect className="shape" x="138" y="52" width="8" height="18" rx="4" fill="#2B2F3B" stroke={selStroke('create')} />
        </g>
        <g className={cls('options', 'options')} onClick={() => pick('options', 'options')}>
          <rect className="shape" x="254" y="52" width="8" height="18" rx="4" fill="#2B2F3B" stroke={selStroke('options')} />
        </g>

        {/* d-pad: four clickable arms */}
        <g>
          <path
            d="M 90 80 h 16 v 16 h 16 v 16 h -16 v 16 h -16 v -16 h -16 v -16 h 16 Z"
            fill="#262A35"
            stroke={['dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight'].includes(selected) ? '#E8EAF0' : 'rgba(255,255,255,0.08)'}
          />
          <rect className={cls('dpadUp', 'dpadUp')} onClick={() => pick('dpadUp', 'dpadUp')} x="90" y="80" width="16" height="16" fill={buttons.dpadUp ? '#4A5163' : 'transparent'} />
          <rect className={cls('dpadDown', 'dpadDown')} onClick={() => pick('dpadDown', 'dpadDown')} x="90" y="112" width="16" height="16" fill={buttons.dpadDown ? '#4A5163' : 'transparent'} />
          <rect className={cls('dpadLeft', 'dpadLeft')} onClick={() => pick('dpadLeft', 'dpadLeft')} x="74" y="96" width="16" height="16" fill={buttons.dpadLeft ? '#4A5163' : 'transparent'} />
          <rect className={cls('dpadRight', 'dpadRight')} onClick={() => pick('dpadRight', 'dpadRight')} x="106" y="96" width="16" height="16" fill={buttons.dpadRight ? '#4A5163' : 'transparent'} />
        </g>

        {/* face buttons */}
        <g className={cls('triangle', 'triangle')} onClick={() => pick('triangle', 'triangle')}>
          <circle className="shape" cx="302" cy="82" r="12" fill={buttons.triangle ? '#2E3648' : '#20242E'} stroke={selected === 'triangle' ? '#E8EAF0' : FACE.triangle} strokeWidth="1.5" />
          <path d="M 302 76 l 6.5 10 h -13 Z" fill="none" stroke={FACE.triangle} strokeWidth="1.8" />
        </g>
        <g className={cls('square', 'square')} onClick={() => pick('square', 'square')}>
          <circle className="shape" cx="274" cy="108" r="12" fill={buttons.square ? '#2E3648' : '#20242E'} stroke={selected === 'square' ? '#E8EAF0' : FACE.square} strokeWidth="1.5" />
          <rect x="268.5" y="102.5" width="11" height="11" fill="none" stroke={FACE.square} strokeWidth="1.8" />
        </g>
        <g className={cls('circle', 'circle')} onClick={() => pick('circle', 'circle')}>
          <circle className="shape" cx="330" cy="108" r="12" fill={buttons.circle ? '#2E3648' : '#20242E'} stroke={selected === 'circle' ? '#E8EAF0' : FACE.circle} strokeWidth="1.5" />
          <circle cx="330" cy="108" r="5.5" fill="none" stroke={FACE.circle} strokeWidth="1.8" />
        </g>
        <g className={cls('cross', 'cross')} onClick={() => pick('cross', 'cross')}>
          <circle className="shape" cx="302" cy="134" r="12" fill={buttons.cross ? '#2E3648' : '#20242E'} stroke={selected === 'cross' ? '#E8EAF0' : FACE.cross} strokeWidth="1.5" />
          <path d="M 297 129 l 10 10 M 307 129 l -10 10" stroke={FACE.cross} strokeWidth="1.8" />
        </g>

        {/* sticks (live deflection) */}
        <g className={cls('lstick', 'l3')} onClick={() => pick('lstick', 'l3')}>
          <circle cx="152" cy="142" r="20" fill="#1D202A" stroke={selected === 'lstick' ? '#E8EAF0' : 'rgba(255,255,255,0.08)'} />
          <circle className="shape" cx={152 + ls.dx} cy={142 + ls.dy} r="12" fill={buttons.l3 ? '#4A5163' : '#282C38'} />
        </g>
        <g className={cls('rstick', 'r3')} onClick={() => pick('rstick', 'r3')}>
          <circle cx="248" cy="142" r="20" fill="#1D202A" stroke={selected === 'rstick' ? '#E8EAF0' : 'rgba(255,255,255,0.08)'} />
          <circle className="shape" cx={248 + rs.dx} cy={142 + rs.dy} r="12" fill={buttons.r3 ? '#4A5163' : '#282C38'} />
        </g>

        {/* PS + mute */}
        <g className={cls('ps', 'ps')} onClick={() => pick('ps', 'ps')}>
          <circle className="shape" cx="200" cy="128" r="9" fill={buttons.ps ? '#333846' : '#262A35'} stroke={selected === 'ps' ? '#E8EAF0' : 'rgba(255,255,255,0.08)'} />
          <text x="200" y="131.5" textAnchor="middle" fontSize="7" fill="#9AA3B2" className="mono">PS</text>
        </g>
        <g className={cls('mute', 'mute')} onClick={() => pick('mute', 'mute')}>
          <rect className="shape" x="194" y="146" width="12" height="6" rx="3" fill={f?.muteLed ? '#FF8C00' : '#262A35'} stroke={selStroke('mute')} />
        </g>
      </svg>
    </div>
  );
}
