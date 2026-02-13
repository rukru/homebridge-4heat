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
export declare const PARAM_ON_OFF = 384;
export declare const PARAM_TEMP_SETPOINT = 199;
export declare const PARAM_MODE = 381;
export declare const STATO: {
    readonly OFF: 0;
    readonly IGNITION_1: 1;
    readonly IGNITION_2: 2;
    readonly STABILIZATION: 3;
    readonly POWER: 4;
    readonly RUNNING: 5;
    readonly SHUTDOWN: 6;
    readonly STANDBY: 7;
    readonly COOLING: 8;
    readonly ERROR: 9;
};
export declare const STATO_LABELS: Record<number, string>;
