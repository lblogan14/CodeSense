/**
 * Ambient declarations so an editor can type-check the firmware without the
 * Moddable SDK installed. The real types come from the SDK at build time; these
 * are deliberately loose (`any`) for the Moddable-specific modules. The `wire`
 * module resolves to the shared bridge types via tsconfig `paths`.
 */
declare function trace(msg: string): void;
declare function require(id: string): any;

// XS runtime extensions used by the serial link
interface ArrayBufferConstructor {
  fromString(s: string): ArrayBuffer;
}
interface StringConstructor {
  fromArrayBuffer(b: ArrayBuffer): string;
}

declare module 'wifi' {
  const WiFi: any;
  export default WiFi;
}
declare module 'websocket' {
  export const Client: any;
}
declare module 'timer' {
  const Timer: any;
  export default Timer;
}
declare module 'mc/config' {
  const config: any;
  export default config;
}
declare module 'piu/MC' {
  export const Application: any;
  export const Skin: any;
  export const Style: any;
  export const Label: any;
  export const Text: any;
  export const Content: any;
  export const Column: any;
  export const Row: any;
  export const Container: any;
  export const Behavior: any;
}
