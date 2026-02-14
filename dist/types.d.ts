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
    cronoName?: string;
    alertSensor?: boolean;
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
    posPunto: number;
    originalHex: string;
    value: number;
    minValue: number;
    maxValue: number;
}
export declare const PARAM_ON_OFF = 384;
export declare const PARAM_TEMP_SETPOINT = 199;
export declare const PARAM_MODE = 381;
export interface SensorValue {
    id: number;
    valore: number;
    min: number;
    max: number;
}
export declare const SENSOR_EXHAUST_TEMP = 65535;
export declare const SENSOR_ROOM_TEMP = 65527;
export declare const SENSOR_BOILER_TEMP = 65532;
export declare const SENSOR_WATER_PRESSURE = 65531;
export declare const SENSOR_FLAME_LIGHT = 65533;
export declare const SENSOR_DHW_TEMP = 65506;
export declare const SENSOR_BUFFER_TEMP = 65530;
export declare const SENSOR_FLOW_TEMP_1 = 65508;
export declare const SENSOR_EXTERNAL_TEMP = 65526;
export declare const SENSOR_AIR_FLOW = 65517;
export declare const STATO: {
    readonly OFF: 0;
    readonly CHECK_UP: 1;
    readonly IGNITION: 2;
    readonly STABILISATION: 3;
    readonly RETRY_IGNITION: 4;
    readonly RUN_MODE: 5;
    readonly MODULATION: 6;
    readonly EXTINGUISHING: 7;
    readonly SAFETY_MODE: 8;
    readonly BLOCK: 9;
    readonly RECOVER_IGNITION: 10;
};
export declare const STATO_LABELS: Record<number, string>;
export declare const ERROR_CODES: Record<number, string>;
export type SensorServiceType = 'TemperatureSensor' | 'HumiditySensor' | 'LightSensor';
export interface SensorMeta {
    id: number;
    configKey: keyof SensorsConfig;
    displayName: string;
    serviceType: SensorServiceType;
    subtype: string;
}
export declare const SENSOR_DEFINITIONS: SensorMeta[];
export declare const STATO_CRONO: {
    readonly DAILY: 32;
    readonly WEEKLY: 33;
    readonly WEEKEND: 34;
    readonly OFF: 35;
};
export declare const CRONO_PERIODO: {
    readonly OFF: 0;
    readonly DAILY: 1;
    readonly WEEKLY: 2;
    readonly WEEKEND: 3;
};
export declare const CRONO_PERIODO_LABELS: Record<number, string>;
export interface CronoTimeSlot {
    start: string;
    end: string;
    enabled: boolean;
}
export interface CronoDaySchedule {
    dayNumber: number;
    slots: CronoTimeSlot[];
}
export interface CronoSchedule {
    periodo: number;
    days: CronoDaySchedule[];
    rawResponse: string;
}
