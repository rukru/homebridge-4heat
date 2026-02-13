import type { PlatformAccessory } from 'homebridge';
import type { DeviceState } from './types.js';
import type { FourHeatPlatform } from './platform.js';
export declare class StoveAccessory {
    private readonly platform;
    private readonly accessory;
    private static readonly HEATING_STATES;
    private readonly thermostatService;
    private readonly defaultName;
    private roomTempService;
    constructor(platform: FourHeatPlatform, accessory: PlatformAccessory);
    updateState(state: DeviceState): void;
    private createRoomTempService;
    private mapCurrentState;
    private isInFaultState;
    private getCurrentHeatingState;
    private getTargetHeatingState;
    private setTargetHeatingState;
    private getCurrentTemperature;
    private getTargetTemperature;
    private setTargetTemperature;
    private getStatusFault;
}
