import { z } from 'zod';
import type { Action, GestureName, ModeName } from './types.js';

// ─── Action schema ───────────────────────────────────────────────

export const actionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keys'), keys: z.string() }),
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('slash'), command: z.string().startsWith('/') }),
  z.object({
    type: z.literal('mode'),
    mode: z.union([z.enum(['AGENT', 'NAV', 'PROMPT']), z.literal('next')]),
  }),
  z.object({
    type: z.literal('session'),
    target: z.union([z.enum(['next', 'prev']), z.number().int().min(1).max(4)]),
  }),
  z.object({ type: z.literal('approve'), scope: z.enum(['once', 'always']) }),
  z.object({ type: z.literal('reject') }),
  z.object({ type: z.literal('interrupt') }),
  z.object({ type: z.literal('dial'), direction: z.enum(['up', 'down']) }),
  z.object({ type: z.literal('palette'), palette: z.string() }),
  z.object({ type: z.literal('macro'), id: z.string() }),
  z.object({
    type: z.literal('voice'),
    action: z.enum(['toggle', 'push', 'pushStart', 'pushEnd']),
  }),
  z.object({ type: z.literal('rewind') }),
  z.object({ type: z.literal('replay-status') }),
  z.object({ type: z.literal('noop') }),
]) as z.ZodType<Action>;

// ─── Gesture keys ────────────────────────────────────────────────

const buttonNames = [
  'cross', 'circle', 'square', 'triangle',
  'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight',
  'l1', 'r1', 'l2', 'r2', 'l3', 'r3',
  'create', 'options', 'ps', 'touchpad', 'mute',
] as const;

const gestureNames: string[] = [
  ...buttonNames.flatMap((b) => [`${b}.press`, `${b}.release`, `${b}.hold`]),
  'touchpad.swipeLeft', 'touchpad.swipeRight', 'touchpad.swipeUp', 'touchpad.swipeDown',
  'lstick.up', 'lstick.down', 'lstick.left', 'lstick.right',
  'rstick.up', 'rstick.down', 'rstick.left', 'rstick.right',
  'r2.pull', 'l2.pull',
  'radial.up', 'radial.down', 'radial.left', 'radial.right',
];

export const gestureNameSchema = z
  .string()
  .refine((g) => gestureNames.includes(g), {
    message: `unknown gesture; expected one of: ${gestureNames.join(', ')}`,
  }) as z.ZodType<GestureName>;

// ─── Binding / chord / profile ───────────────────────────────────

export const bindingSchema = z.object({
  action: actionSchema,
  /** human-readable description shown in the dashboard */
  label: z.string().optional(),
  /** for stick gestures: repeat while held (default true for sticks/dpad) */
  repeat: z.boolean().optional(),
});
export type Binding = z.infer<typeof bindingSchema>;

export const chordSchema = z.object({
  /** all buttons that must be held simultaneously (2..4) */
  buttons: z.array(z.enum(buttonNames)).min(2).max(4),
  action: actionSchema,
  label: z.string().optional(),
  /** restrict chord to a mode, or "*" for all modes */
  mode: z.union([z.enum(['AGENT', 'NAV', 'PROMPT']), z.literal('*')]).default('*'),
});
export type Chord = z.infer<typeof chordSchema>;

export const paletteEntrySchema = z.object({
  label: z.string(),
  action: actionSchema,
});

export const profileSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.number().int().default(1),
  options: z
    .object({
      stickDeadzone: z.number().min(0).max(0.9).default(0.18),
      holdMs: z.number().int().min(100).default(450),
      repeatDelayMs: z.number().int().min(50).default(350),
      repeatIntervalMs: z.number().int().min(16).default(90),
      swipeThreshold: z.number().int().min(50).default(220),
      /** R2 approval thresholds (0..1) */
      approveArm: z.number().min(0.05).max(0.9).default(0.4),
      approveFull: z.number().min(0.5).max(1).default(0.92),
      approveRelease: z.number().min(0).max(0.5).default(0.15),
      /** commands stepped through by the reasoning dial, low → high */
      dialCommands: z
        .array(z.string())
        .min(2)
        .default(['/effort low', '/effort medium', '/effort high', '/effort xhigh', '/effort max']),
    })
    .default({}),
  modes: z.record(
    z.enum(['AGENT', 'NAV', 'PROMPT']),
    z.object({
      bindings: z.record(gestureNameSchema, bindingSchema),
    }),
  ),
  chords: z.array(chordSchema).default([]),
  /** named palettes: square opens "commands", etc. */
  palettes: z.record(z.string(), z.array(paletteEntrySchema)).default({}),
  /** named macros: sequences of actions */
  macros: z.record(z.string(), z.array(actionSchema)).default({}),
});

export type Profile = z.infer<typeof profileSchema>;
export type ProfileModeName = ModeName;

export function parseProfile(json: unknown): Profile {
  return profileSchema.parse(json);
}

export function safeParseProfile(json: unknown):
  | { ok: true; profile: Profile }
  | { ok: false; error: string } {
  const res = profileSchema.safeParse(json);
  if (res.success) return { ok: true, profile: res.data };
  return {
    ok: false,
    error: res.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n'),
  };
}
