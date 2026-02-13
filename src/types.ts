import type { PlatformConfig } from 'homebridge';

export interface SensorsConfig {
  exhaustTemp?: boolean;
  roomTemp?: boolean;
  boilerTemp?: boolean;
  dhwTemp?: boolean;
  bufferTemp?: boolean;
  flowTemp?: boolean;
  externalTemp?: boolean;
  waterPressure?: boolean;
  flameLight?: boolean;
  airFlow?: boolean;
}

export interface FourHeatConfig extends PlatformConfig {
  host?: string;
  port?: number;
  pollingInterval?: number;
  minTemp?: number;
  maxTemp?: number;
  sensors?: SensorsConfig;
  switchDebounce?: number;
  logLevel?: 'normal' | 'verbose' | 'debug';
  cronoSwitch?: boolean;
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
  statoCrono: number;
  parameters: Map<number, ParameterValue>;
  sensors: Map<number, SensorValue>;
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

export interface SensorValue {
  id: number;
  valore: number;
  min: number;
  max: number;
}

export const SENSOR_EXHAUST_TEMP = 0xFFFF;
export const SENSOR_ROOM_TEMP = 0xFFF7;
export const SENSOR_BOILER_TEMP = 0xFFFC;
export const SENSOR_WATER_PRESSURE = 0xFFFB;
export const SENSOR_FLAME_LIGHT = 0xFFFD;
export const SENSOR_DHW_TEMP = 0xFFE2;
export const SENSOR_BUFFER_TEMP = 0xFFFA;
export const SENSOR_FLOW_TEMP_1 = 0xFFE4;
export const SENSOR_EXTERNAL_TEMP = 0xFFF6;
export const SENSOR_AIR_FLOW = 0xFFED;

export const STATO = {
  OFF: 0,
  CHECK_UP: 1,
  IGNITION: 2,
  STABILISATION: 3,
  RETRY_IGNITION: 4,
  RUN_MODE: 5,
  MODULATION: 6,
  EXTINGUISHING: 7,
  SAFETY_MODE: 8,
  BLOCK: 9,
  RECOVER_IGNITION: 10,
} as const;

export const STATO_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'Check Up',
  2: 'Ignition',
  3: 'Stabilisation',
  4: 'Retry Ignition',
  5: 'Run Mode',
  6: 'Modulation',
  7: 'Extinguishing',
  8: 'Safety Mode',
  9: 'Block',
  10: 'Recover Ignition',
};

export const ERROR_CODES: Record<number, string> = {
  0: 'System OK',
  1: 'High voltage safety 1',
  2: 'High voltage safety 2',
  3: 'Low flue temperature',
  4: 'Water over-temperature',
  5: 'Flue overheating',
  6: 'Pellet thermostat',
  7: 'Fan encoder stopped',
  8: 'Fan encoder not regulating',
  9: 'Minimum water pressure',
  10: 'Maximum water pressure',
  11: 'Real time clock failure',
  12: 'Ignition failed',
  13: 'Accidental extinguishing',
  14: 'Pressure switch',
  15: 'Lack of power supply',
  16: 'RS485 communication failure',
  17: 'Air flow sensor not regulating',
  18: 'Pellet ended',
  19: 'Pellet consent',
  20: 'Wood/pellet switch failure',
  21: 'Overheating flue probe 2',
  22: 'Oxygen regulation failure',
  23: 'Probe disconnected',
  24: 'Igniter broken',
  25: 'Safety engine 1',
  26: 'Safety engine 2',
  27: 'Safety engine 3',
  28: 'Safety engine 4',
  29: 'Safety engine 5',
  30: 'Overheating air probe',
  31: 'Pellet valve closed',
  32: 'Water pressure sensor',
  33: 'Tube bundle cleaning engine failure',
  34: 'Minimum aspiration air',
  35: 'Maximum aspiration air',
  36: 'Probe reading value out of range',
  37: 'Stirrer engine failure',
  38: 'Pump failure',
  39: 'Air flow sensor failure',
  40: 'Service',
  41: 'Minimum air flow',
  42: 'Maximum air flow',
  43: 'Flow switch',
  44: 'Door open',
  45: 'Limit switch failure',
  46: 'Level switch failure',
  47: 'Encoder loading engine stopped',
  48: 'Encoder loading engine not regulating',
  49: 'Combustion alarm',
  50: 'Maximum peak alarm',
  51: 'Damper position alarm',
  52: 'Additional I2C module not communicating',
  53: 'Encoder loading engine 2 stopped',
  54: 'Encoder loading engine 2 not regulating',
  55: 'User maintenance service',
  56: 'Plumbing plant changed',
  57: 'Forced draught high',
  58: 'Overheating oven',
  59: 'Condensation',
  60: 'Pressure switch aspiration fan',
  61: 'Pressure switch combustion fan',
  62: 'Brazier full',
  63: 'Encoder fan 2 broken',
  64: 'Encoder fan 2 not regulating',
  65: 'Encoder fan 3 broken',
  66: 'Encoder fan 3 not regulating',
  68: 'Selector',
  76: 'Safety engine 6',
  77: 'Grid 2',
  81: 'Motherboard overtemperature',
  200: 'Lambda sensor failure',
  201: 'Heater sensor shorted to ground',
  202: 'Heater sensor disconnected',
  203: 'Heater sensor shorted to +12v',
  204: 'Lambda sensor shorted to ground',
  205: 'Lambda supply voltage low',
  206: 'Lambda sensor shorted to +12v',
  207: 'Heating sensor timeout',
  208: 'Overheated lambda sensor',
};

export type SensorServiceType = 'TemperatureSensor' | 'HumiditySensor' | 'LightSensor';

export interface SensorMeta {
  id: number;
  configKey: keyof SensorsConfig;
  displayName: string;
  serviceType: SensorServiceType;
  subtype: string;
}

export const SENSOR_DEFINITIONS: SensorMeta[] = [
  { id: SENSOR_EXHAUST_TEMP, configKey: 'exhaustTemp', displayName: 'Exhaust Temperature', serviceType: 'TemperatureSensor', subtype: 'exhaust-temp' },
  { id: SENSOR_ROOM_TEMP, configKey: 'roomTemp', displayName: 'Room Temperature', serviceType: 'TemperatureSensor', subtype: 'room-temp' },
  { id: SENSOR_BOILER_TEMP, configKey: 'boilerTemp', displayName: 'Boiler Temperature', serviceType: 'TemperatureSensor', subtype: 'boiler-temp' },
  { id: SENSOR_DHW_TEMP, configKey: 'dhwTemp', displayName: 'DHW Temperature', serviceType: 'TemperatureSensor', subtype: 'dhw-temp' },
  { id: SENSOR_BUFFER_TEMP, configKey: 'bufferTemp', displayName: 'Buffer Temperature', serviceType: 'TemperatureSensor', subtype: 'buffer-temp' },
  { id: SENSOR_FLOW_TEMP_1, configKey: 'flowTemp', displayName: 'Flow Temperature', serviceType: 'TemperatureSensor', subtype: 'flow-temp' },
  { id: SENSOR_EXTERNAL_TEMP, configKey: 'externalTemp', displayName: 'External Temperature', serviceType: 'TemperatureSensor', subtype: 'external-temp' },
  { id: SENSOR_WATER_PRESSURE, configKey: 'waterPressure', displayName: 'Water Pressure', serviceType: 'HumiditySensor', subtype: 'water-pressure' },
  { id: SENSOR_FLAME_LIGHT, configKey: 'flameLight', displayName: 'Flame Light', serviceType: 'LightSensor', subtype: 'flame-light' },
  { id: SENSOR_AIR_FLOW, configKey: 'airFlow', displayName: 'Air Flow', serviceType: 'LightSensor', subtype: 'air-flow' },
];

// --- Crono (schedule) types ---

export const STATO_CRONO = {
  DAILY: 0x20,
  WEEKLY: 0x21,
  WEEKEND: 0x22,
  OFF: 0x23,
} as const;

export const CRONO_PERIODO = {
  OFF: 0,
  DAILY: 1,
  WEEKLY: 2,
  WEEKEND: 3,
} as const;

export const CRONO_PERIODO_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'Daily',
  2: 'Weekly',
  3: 'Weekend',
};

export interface CronoTimeSlot {
  start: string;   // "HH:MM"
  end: string;     // "HH:MM"
  enabled: boolean;
}

export interface CronoDaySchedule {
  dayNumber: number;        // 1-7 (Mon-Sun)
  slots: CronoTimeSlot[];   // always 3 slots
}

export interface CronoSchedule {
  periodo: number;            // 0=off, 1=daily, 2=weekly, 3=weekend
  days: CronoDaySchedule[];   // always 7 days
  rawResponse: string;        // original CCG response for reference
}
