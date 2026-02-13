import type { PlatformConfig } from 'homebridge';

export interface FourHeatConfig extends PlatformConfig {
  host?: string;
  port?: number;
  pollingInterval?: number;
  minTemp?: number;
  maxTemp?: number;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
}

export interface DeviceState {
  stato: number;
  errore: number;
  tempPrinc: number;
  tempSec: number;
  posPunto: number;
  parameters: Map<number, ParameterValue>;
  lastUpdate: Date;
}

export interface ParameterValue {
  id: number;
  valore: number;
  min: number;
  max: number;
  readOnly: boolean;
  posPunto: number;
  originalHex: string;
  value: number;
  minValue: number;
  maxValue: number;
}

export const PARAM_ON_OFF = 0x0180;
export const PARAM_TEMP_SETPOINT = 0x00c7;
export const PARAM_MODE = 0x017d;

export const STATO = {
  OFF: 0,
  IGNITION_1: 1,
  IGNITION_2: 2,
  STABILIZATION: 3,
  POWER: 4,
  RUNNING: 5,
  SHUTDOWN: 6,
  STANDBY: 7,
  COOLING: 8,
  ERROR: 9,
} as const;

export const STATO_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'Ignition 1',
  2: 'Ignition 2',
  3: 'Stabilization',
  4: 'Power',
  5: 'Running',
  6: 'Shutdown',
  7: 'Standby',
  8: 'Cooling',
  9: 'Error/Blocked',
};
