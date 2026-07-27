/**
 * Newline-delimited JSON framing for byte-stream transports (serial, and any
 * future raw socket). Each message is one JSON object terminated by '\n'.
 * Pure and I/O-free so it can be unit-tested directly.
 */

/** Encode one message as a single framed line. */
export function encodeLine(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

/**
 * Reassembles complete lines from arbitrarily-chunked input. Handles messages
 * split across chunks, multiple messages per chunk, and CRLF endings.
 */
export class LineDecoder {
  private buf = '';

  /** Feed a chunk; returns any complete, non-empty lines it completed. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  /** Drop any buffered partial line (e.g. on reconnect). */
  reset(): void {
    this.buf = '';
  }
}
