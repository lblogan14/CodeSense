import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonSnapshot, PaletteState } from './types';

export interface LogLine {
  line: string;
  at: number;
}

export interface TranscriptEntry {
  slot: number;
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface DaemonConnection {
  connected: boolean;
  snapshot: DaemonSnapshot | null;
  palette: PaletteState | null;
  profile: unknown | null;
  profileResult: { ok: boolean; error?: string } | null;
  logs: LogLine[];
  transcripts: TranscriptEntry[];
  send: (msg: Record<string, unknown>) => void;
}

const MAX_LOGS = 200;

export function useDaemon(): DaemonConnection {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<DaemonSnapshot | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [profile, setProfile] = useState<unknown | null>(null);
  const [profileResult, setProfileResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) retry = setTimeout(connect, 1200);
      };
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        switch (msg.type) {
          case 'snapshot':
            setSnapshot(msg.snapshot as DaemonSnapshot);
            break;
          case 'palette':
            setPalette(msg.palette as PaletteState);
            break;
          case 'profile':
            setProfile(msg.profile);
            break;
          case 'profile-result':
            setProfileResult({ ok: Boolean(msg.ok), error: msg.error as string | undefined });
            break;
          case 'log':
            setLogs((prev) =>
              [...prev, { line: String(msg.line), at: Number(msg.at) || Date.now() }].slice(
                -MAX_LOGS,
              ),
            );
            break;
          case 'transcript':
            setTranscripts((prev) =>
              [
                ...prev,
                {
                  slot: Number(msg.slot) || 1,
                  role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
                  text: String(msg.text),
                  at: Number(msg.at) || Date.now(),
                },
              ].slice(-400),
            );
            break;
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { connected, snapshot, palette, profile, profileResult, logs, transcripts, send };
}
