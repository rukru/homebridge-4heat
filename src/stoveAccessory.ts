import type { PlatformAccessory, CharacteristicValue, Service } from 'homebridge';
import type { DeviceState } from './types.js';
import { PARAM_ON_OFF, PARAM_TEMP_SETPOINT, STATO } from './types.js';
import type { FourHeatPlatform } from './platform.js';

export class StoveAccessory {
  private readonly thermostatService: Service;
  private readonly errorResetService: Service;

  constructor(
    private readonly platform: FourHeatPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = platform;

    // Accessory Information
    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, '4HEAT / TiEmme Elettronica')
      .setCharacteristic(Characteristic.Model, 'PinKEY in box')
      .setCharacteristic(Characteristic.SerialNumber, platform.client?.currentHost ?? 'unknown');

    // --- Thermostat service ---
    this.thermostatService = accessory.getService(Service.Thermostat)
      ?? accessory.addService(Service.Thermostat);

    this.thermostatService.setCharacteristic(Characteristic.Name, platform.config.name || '4HEAT Stove');

    this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.getCurrentHeatingState());

    this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          Characteristic.TargetHeatingCoolingState.OFF,
          Characteristic.TargetHeatingCoolingState.HEAT,
        ],
      })
      .onGet(() => this.getTargetHeatingState())
      .onSet((value) => this.setTargetHeatingState(value));

    this.thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: -10, maxValue: 100, minStep: 0.1 })
      .onGet(() => this.getCurrentTemperature());

    this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
        minValue: platform.minTemp,
        maxValue: platform.maxTemp,
        minStep: 1,
      })
      .onGet(() => this.getTargetTemperature())
      .onSet((value) => this.setTargetTemperature(value));

    this.thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .setProps({ validValues: [Characteristic.TemperatureDisplayUnits.CELSIUS] })
      .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS);

    this.thermostatService.addOptionalCharacteristic(Characteristic.StatusFault);
    this.thermostatService.getCharacteristic(Characteristic.StatusFault)
      .onGet(() => this.getStatusFault());

    // --- Error Reset switch (linked to Thermostat) ---
    this.errorResetService = accessory.getService('Error Reset')
      ?? accessory.addService(Service.Switch, 'Error Reset', 'error-reset');

    this.errorResetService.getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet((value) => this.handleErrorReset(value));

    this.thermostatService.addLinkedService(this.errorResetService);
  }

  updateState(state: DeviceState) {
    const { Characteristic } = this.platform;

    this.thermostatService.updateCharacteristic(
      Characteristic.CurrentTemperature,
      state.tempPrinc,
    );

    this.thermostatService.updateCharacteristic(
      Characteristic.CurrentHeatingCoolingState,
      this.mapCurrentState(state.stato),
    );

    this.thermostatService.updateCharacteristic(
      Characteristic.StatusFault,
      state.stato === STATO.ERROR
        ? Characteristic.StatusFault.GENERAL_FAULT
        : Characteristic.StatusFault.NO_FAULT,
    );

    const setpointParam = state.parameters.get(PARAM_TEMP_SETPOINT);
    if (setpointParam) {
      this.thermostatService.updateCharacteristic(
        Characteristic.TargetTemperature,
        setpointParam.value,
      );
    }

    const onOffParam = state.parameters.get(PARAM_ON_OFF);
    if (onOffParam) {
      this.thermostatService.updateCharacteristic(
        Characteristic.TargetHeatingCoolingState,
        onOffParam.value === 1
          ? Characteristic.TargetHeatingCoolingState.HEAT
          : Characteristic.TargetHeatingCoolingState.OFF,
      );
    }
  }

  private mapCurrentState(stato: number): number {
    const { Characteristic } = this.platform;
    if (stato >= STATO.IGNITION_1 && stato <= STATO.RUNNING) {
      return Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    return Characteristic.CurrentHeatingCoolingState.OFF;
  }

  private getCurrentHeatingState(): number {
    const stato = this.platform.deviceState?.stato ?? 0;
    return this.mapCurrentState(stato);
  }

  private getTargetHeatingState(): number {
    const { Characteristic } = this.platform;
    const param = this.platform.deviceState?.parameters.get(PARAM_ON_OFF);
    if (param && param.value === 1) {
      return Characteristic.TargetHeatingCoolingState.HEAT;
    }
    return Characteristic.TargetHeatingCoolingState.OFF;
  }

  private async setTargetHeatingState(value: CharacteristicValue) {
    const { Characteristic } = this.platform;
    const onOff = value === Characteristic.TargetHeatingCoolingState.HEAT ? 1 : 0;
    this.platform.log.info('Setting stove %s', onOff ? 'ON' : 'OFF');
    await this.platform.writeParameter(PARAM_ON_OFF, onOff);
  }

  private getCurrentTemperature(): number {
    return this.platform.deviceState?.tempPrinc ?? 0;
  }

  private getTargetTemperature(): number {
    const param = this.platform.deviceState?.parameters.get(PARAM_TEMP_SETPOINT);
    return param?.value ?? this.platform.minTemp;
  }

  private async setTargetTemperature(value: CharacteristicValue) {
    const temp = value as number;
    this.platform.log.info('Setting target temperature to %d°C', temp);
    await this.platform.writeParameter(PARAM_TEMP_SETPOINT, temp);
  }

  private getStatusFault(): number {
    const { Characteristic } = this.platform;
    const stato = this.platform.deviceState?.stato ?? 0;
    return stato === STATO.ERROR
      ? Characteristic.StatusFault.GENERAL_FAULT
      : Characteristic.StatusFault.NO_FAULT;
  }

  private async handleErrorReset(value: CharacteristicValue) {
    if (value) {
      this.platform.log.info('Resetting stove error');
      await this.platform.resetError();
      setTimeout(() => {
        this.errorResetService.updateCharacteristic(
          this.platform.Characteristic.On,
          false,
        );
      }, 1000);
    }
  }
}
