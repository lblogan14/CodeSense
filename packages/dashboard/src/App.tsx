import { useEffect, useMemo, useRef, useState } from 'react';
import { ControllerViz } from './ControllerViz';
import { useDaemon } from './useDaemon';
import type { AgentStateName, ModeName } from './types';
import { STATE_HEX, STATE_ICON, STATE_LABEL } from './types';

const MODES: ModeName[] = ['AGENT', 'NAV', 'PROMPT'];

/** gestures shown for a selected control, in priority order */
const CONTROL_GESTURES: Record<string, string[]> = {
  cross: ['cross.press', 'cross.hold'],
  circle: ['circle.press'],
  square: ['square.press'],
  triangle: ['triangle.press'],
  dpadUp: ['dpadUp.press'],
  dpadDown: ['dpadDown.press'],
  dpadLeft: ['dpadLeft.press'],
  dpadRight: ['dpadRight.press'],
  l1: ['l1.press'],
  r1: ['r1.press'],
  l2: ['l2.hold', 'l2.press', 'l2.pull'],
  r2: ['r2.pull', 'r2.press'],
  lstick: ['lstick.up', 'lstick.down', 'lstick.left', 'lstick.right'],
  rstick: ['rstick.up', 'rstick.down', 'rstick.left', 'rstick.right'],
  touchpad: ['touchpad.swipeLeft', 'touchpad.swipeRight', 'touchpad.swipeUp', 'touchpad.swipeDown'],
  create: ['create.press'],
  options: ['options.press'],
  ps: ['ps.press'],
  mute: ['mute.press'],
  lightbar: [],
};

const CONTROL_LABEL: Record<string, string> = {
  cross: '✕ Cross', circle: '◯ Circle', square: '▢ Square', triangle: '△ Triangle',
  dpadUp: 'D-pad up', dpadDown: 'D-pad down', dpadLeft: 'D-pad left', dpadRight: 'D-pad right',
  l1: 'L1', r1: 'R1', l2: 'L2 (analog)', r2: 'R2 (analog)',
  lstick: 'Left stick', rstick: 'Right stick', touchpad: 'Touchpad',
  create: 'Create', options: 'Options', ps: 'PS button', mute: 'Mute', lightbar: 'Lightbar',
};

export default function App() {
  const { connected, snapshot, palette, profile, profileResult, logs, send } = useDaemon();
  const [selected, setSelected] = useState('r2');
  const [promptText, setPromptText] = useState('');
  const [profileDraft, setProfileDraft] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const state: AgentStateName = snapshot?.agentState ?? 'disconnected';
  const stateColor = STATE_HEX[state];
  const mode = snapshot?.mode ?? 'AGENT';

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  useEffect(() => {
    if (profile && !profileDraft) setProfileDraft(JSON.stringify(profile, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const bindings = useMemo(() => {
    const p = profile as {
      modes?: Record<string, { bindings?: Record<string, { label?: string }> }>;
      chords?: { buttons: string[]; label?: string }[];
    } | null;
    const modeBindings = p?.modes?.[mode]?.bindings ?? {};
    const rows: { gesture: string; label: string }[] = [];
    for (const g of CONTROL_GESTURES[selected] ?? []) {
      const b = modeBindings[g];
      if (b) rows.push({ gesture: g, label: b.label ?? '(unlabeled action)' });
    }
    if (selected === 'r2') {
      rows.unshift({ gesture: 'r2 analog pull', label: 'Approve permission — feather = once, full pull = always' });
    }
    if (selected === 'lightbar') {
      rows.push({ gesture: 'output only', label: 'Agent status display (not a button)' });
    }
    const chords = (p?.chords ?? []).filter((c) => c.buttons.includes(selected));
    for (const c of chords) {
      rows.push({ gesture: `chord: ${c.buttons.join(' + ')}`, label: c.label ?? '' });
    }
    return rows;
  }, [profile, mode, selected]);

  const c = snapshot?.controller;
  const battery = c?.battery;

  return (
    <div className="app">
      {/* palette overlay */}
      {palette?.open && (
        <div className="overlay" onClick={() => send({ type: 'palette-close' })}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <div className="title">{palette.name} palette</div>
            {palette.entries.map((e, i) => (
              <div
                key={i}
                className={`entry ${i === palette.selected ? 'sel' : ''}`}
                onMouseEnter={() => send({ type: 'palette-select', index: i })}
                onClick={() => send({ type: 'palette-confirm' })}
              >
                <span>{e.label}</span>
                {i === palette.selected && <span className="dim mono small">✕ confirm</span>}
              </div>
            ))}
            <div className="hint">d-pad navigate · ✕ confirm · ◯ close</div>
          </div>
        </div>
      )}

      {/* header */}
      <div className="header">
        <div className="wordmark">
          <span className="glyphs">△◯✕▢</span>
          <span>codesense</span>
        </div>
        <div className="modes" style={{ width: 260 }} role="tablist" aria-label="mapping mode">
          {MODES.map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => send({ type: 'set-mode', mode: m })}>
              {m}
            </button>
          ))}
        </div>
        <div className="meta mono">
          <span>
            <span className="statusdot" style={{ background: connected ? '#2FD48A' : '#FF5C5C' }} />
            {connected ? 'daemon' : 'reconnecting…'}
          </span>
          <span>
            <span className="statusdot" style={{ background: c?.connected ? '#2FD48A' : '#5C6470' }} />
            {c?.connected ? `controller · ${c.connection}` : 'no controller'}
          </span>
          {battery && c?.connected && (
            <span>
              {battery.level}%{battery.charging ? ' ⚡' : ''}
            </span>
          )}
          <span>{snapshot?.backend ?? ''} backend</span>
          <span>profile: {snapshot?.profileName ?? '—'}</span>
        </div>
      </div>

      <div className="grid">
        {/* ── left column ── */}
        <div className="col">
          <div className="card">
            <div className="statestrip" style={{ background: stateColor }} />
            <h2>controller</h2>
            <ControllerViz snapshot={snapshot} selected={selected} onSelect={setSelected} send={send} />
          </div>

          <div className="card">
            <h2>
              {CONTROL_LABEL[selected] ?? selected} <span className="dim">· {mode} mode</span>
            </h2>
            {bindings.length === 0 && <div className="dim small">no binding in this mode</div>}
            <div className="kv">
              {bindings.map((b) => (
                <div key={b.gesture} style={{ display: 'contents' }}>
                  <span className="k">{b.gesture}</span>
                  <span>{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>
              profile editor{' '}
              <button className="btn small" style={{ marginLeft: 8 }} onClick={() => setProfileOpen((o) => !o)}>
                {profileOpen ? 'collapse' : 'expand'}
              </button>
            </h2>
            {profileOpen && (
              <>
                <textarea
                  rows={18}
                  value={profileDraft}
                  onChange={(e) => setProfileDraft(e.target.value)}
                  spellCheck={false}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn primary"
                    onClick={() => {
                      try {
                        send({ type: 'set-profile', profile: JSON.parse(profileDraft) });
                      } catch (err) {
                        alert(`not valid JSON: ${String(err)}`);
                      }
                    }}
                  >
                    validate + apply
                  </button>
                  <button className="btn" onClick={() => setProfileDraft(JSON.stringify(profile, null, 2))}>
                    reset to live
                  </button>
                  {profileResult && (
                    <span className={`small mono`} style={{ color: profileResult.ok ? '#2FD48A' : '#FF5C5C' }}>
                      {profileResult.ok ? '✓ applied + saved' : `✕ ${profileResult.error?.split('\n')[0]}`}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── right column ── */}
        <div className="col">
          <div className="card">
            <div className="statestrip" style={{ background: stateColor }} />
            <h2>agent status</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <span
                className={`mono ${state === 'thinking' ? 'anim-thinking' : ''} ${state === 'permission' ? 'anim-permission' : ''}`}
                style={{ color: stateColor, fontSize: 15, fontWeight: 600 }}
              >
                {STATE_ICON[state]} {STATE_LABEL[state]}
              </span>
              <span className="dim mono small" style={{ marginLeft: 'auto' }}>
                lightbar rgb({snapshot?.feedback.lightbar.r ?? 0},{snapshot?.feedback.lightbar.g ?? 0},{snapshot?.feedback.lightbar.b ?? 0})
              </span>
            </div>

            {state === 'permission' && (
              <div
                style={{
                  border: '1px solid rgba(255,176,32,0.4)',
                  background: 'rgba(255,176,32,0.08)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginBottom: 6,
                }}
              >
                <div className="small" style={{ marginBottom: 8 }}>
                  <span className="mono" style={{ color: '#FFB020' }}>▲ </span>
                  Claude wants to run{' '}
                  <span className="mono">{snapshot?.pendingPermission?.toolName ?? 'a tool'}</span>
                  <span className="dim"> — pull R2 on the pad, or:</span>
                </div>
                <div className="row">
                  <button className="btn amber" onClick={() => send({ type: 'action', action: { type: 'approve', scope: 'once' } })}>
                    approve once <span className="dim">(feather R2)</span>
                  </button>
                  <button className="btn amber" onClick={() => send({ type: 'action', action: { type: 'approve', scope: 'always' } })}>
                    always allow <span className="dim">(full pull)</span>
                  </button>
                  <button className="btn danger" onClick={() => send({ type: 'action', action: { type: 'reject' } })}>
                    reject <span className="dim">(◯)</span>
                  </button>
                </div>
              </div>
            )}

            <div className="chips" style={{ marginTop: 4 }}>
              {(['idle', 'thinking', 'permission', 'done', 'error'] as AgentStateName[]).map((s) => (
                <span key={s} className={`chip ${state === s ? 'on' : ''}`} style={{ ['--chip-color' as never]: STATE_HEX[s] }}>
                  {STATE_ICON[s]} {s}
                </span>
              ))}
            </div>
          </div>

          {snapshot?.backend === 'sdk' && (
            <div className="card">
              <h2>sessions</h2>
              <div className="sessions">
                {[1, 2, 3, 4].map((slot) => {
                  const s = snapshot.sessions.find((x) => x.slot === slot);
                  const sState = s?.state ?? 'disconnected';
                  return (
                    <div
                      key={slot}
                      className={`session-cell ${snapshot.activeSessionSlot === slot ? 'active' : ''}`}
                      onClick={() => send({ type: 'action', action: { type: 'session', target: slot } })}
                    >
                      <div className="statestrip" style={{ background: s ? STATE_HEX[sState] : 'transparent' }} />
                      <div className="mono small" style={{ color: s ? STATE_HEX[sState] : 'var(--text-muted)' }}>
                        {STATE_ICON[sState]} session {slot}
                      </div>
                      <div className="dim small" style={{ marginTop: 3 }}>
                        {s ? (s.label ?? s.cwd ?? sState) : 'empty · L1/R1 to switch'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card">
            <h2>prompt {snapshot?.backend === 'sdk' ? `→ session ${snapshot.activeSessionSlot}` : '→ claude'}</h2>
            <textarea
              rows={3}
              placeholder={snapshot?.backend === 'sdk' ? 'start or continue the active session…' : 'type into the wrapped claude terminal…'}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  send({ type: 'prompt', text: promptText });
                  setPromptText('');
                }
              }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn primary"
                onClick={() => {
                  if (!promptText.trim()) return;
                  send({ type: 'prompt', text: promptText });
                  setPromptText('');
                }}
              >
                send <span className="dim">(ctrl+enter)</span>
              </button>
              <button className="btn" onClick={() => send({ type: 'action', action: { type: 'palette', palette: 'prompts' } })}>
                presets ▢
              </button>
              <button className="btn" onClick={() => send({ type: 'action', action: { type: 'interrupt' } })}>
                interrupt ◯
              </button>
            </div>
          </div>

          <div className="card">
            <h2>daemon log</h2>
            <div className="log" ref={logRef}>
              {logs.length === 0 && <span className="dim">waiting for events…</span>}
              {logs.map((l, i) => (
                <div key={i}>
                  <span className="time">{new Date(l.at).toLocaleTimeString()}</span>
                  {l.line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="dim small mono" style={{ marginTop: 22, lineHeight: 1.7 }}>
        △ plan · ◯ interrupt · ✕ accept · ▢ palette · R2 approve (depth = scope) · PS cycles mode ·
        L1+R1+△ /clear — not affiliated with Sony or PlayStation.
      </p>
    </div>
  );
}
