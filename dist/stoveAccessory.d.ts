import type { PlatformAccessory } from 'homebridge';
import type { DeviceState } from './types.js';
import type { FourHeatPlatform } from './platform.js';
export declare class StoveAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly thermostatService;
    private readonly errorResetService;
    constructor(platform: FourHeatPlatform, accessory: PlatformAccessory);
    updateState(state: DeviceState): void;
    private mapCurrentState;
    private getCurrentHeatingState;
    private getTargetHeatingState;
    private setTargetHeatingState;
    private getCurrentTemperature;
    private getTargetTemperature;
    private setTargetTemperature;
    private getStatusFault;
    private handleErrorReset;
}
