import pc from 'picocolors';

/** PlayStation glyph quartet, gradient-tinted (the CodeSense wordmark). */
export function banner(version: string): string {
  const glyphs = `${pc.green('△')} ${pc.red('◯')} ${pc.blue('✕')} ${pc.magenta('▢')}`;
  return `${glyphs} ${pc.bold('codesense')} ${pc.dim('v' + version)}`;
}

export const icon = {
  ok: pc.green('✓'),
  warn: pc.yellow('▲'),
  err: pc.red('✕'),
  info: pc.blue('◆'),
  dot: pc.dim('·'),
};

export function kv(label: string, value: string): string {
  return `  ${pc.dim(label.padEnd(12))} ${value}`;
}

export function statusLine(parts: string[]): string {
  return pc.dim(parts.join(' · '));
}
