/**
 * A device-facing transport. WiFi (P1), serial (P2), and MQTT (P3) each
 * implement this one contract, so the bridge is transport-agnostic and
 * multiple transports can run at once.
 */
import { TypedEmitter } from '@codesense/core';
import type { DeviceEvent, HudFrame } from '../protocol.js';

export interface TransportEvents extends Record<string, unknown> {
  event: { ev: DeviceEvent; deviceId: string };
  connect: { deviceId: string };
  disconnect: { deviceId: string };
}

export abstract class Transport extends TypedEmitter<TransportEvents> {
  abstract readonly name: string;
  /** begin accepting device connections */
  abstract start(): Promise<void> | void;
  /** push the latest frame to every connected device */
  abstract broadcast(frame: HudFrame): void;
  /** number of connected (and authenticated) devices */
  abstract get deviceCount(): number;
  abstract stop(): Promise<void> | void;
}
