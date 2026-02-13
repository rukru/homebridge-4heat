import type { PlatformAccessory, CharacteristicValue, Service } from 'homebridge';
import type { DeviceState } from './types.js';
import { PARAM_TEMP_SETPOINT, STATO, ERROR_CODES, SENSOR_ROOM_TEMP } from './types.js';
import { applyPosPunto } from './protocol.js';
import type { FourHeatPlatform } from './platform.js';

export class StoveAccessory {
  private static readonly HEATING_STATES: Set<number> = new Set([
    STATO.CHECK_UP,
    STATO.IGNITION,
    STATO.STABILISATION,
    STATO.RETRY_IGNITION,
    STATO.RUN_MODE,
    STATO.MODULATION,
    STATO.RECOVER_IGNITION,
  ]);

  private readonly thermostatService: Service;
  private readonly defaultName: string;
  private roomTempService: Service | null = null;

  constructor(
    private readonly platform: FourHeatPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = platform;

    this.defaultName = platform.config.name || '4HEAT Stove';

    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, '4HEAT / TiEmme Elettronica')
      .setCharacteristic(Characteristic.Model, 'PinKEY in box')
      .setCharacteristic(Characteristic.SerialNumber, platform.client?.currentHost ?? 'unknown');

    // --- Thermostat service ---
    this.thermostatService = accessory.getService(Service.Thermostat)
      ?? accessory.addService(Service.Thermostat);

    this.thermostatService.setCharacteristic(Characteristic.Name, this.defaultName);

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

    // Remove legacy Error Reset switch if it exists from previous version
    const legacySwitch = accessory.getService('Error Reset');
    if (legacySwitch) {
      accessory.removeService(legacySwitch);
    }
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
      this.isInFaultState(state.stato)
        ? Characteristic.StatusFault.GENERAL_FAULT
        : Characteristic.StatusFault.NO_FAULT,
    );

    // Update name to show error info or restore default
    if (this.isInFaultState(state.stato) && state.errore > 0) {
      const errorDesc = ERROR_CODES[state.errore] ?? 'Unknown';
      this.thermostatService.updateCharacteristic(
        Characteristic.Name,
        `Error ${state.errore}: ${errorDesc}`,
      );
    } else {
      this.thermostatService.updateCharacteristic(
        Characteristic.Name,
        this.defaultName,
      );
    }

    const setpointParam = state.parameters.get(PARAM_TEMP_SETPOINT);
    if (setpointParam) {
      this.thermostatService.updateCharacteristic(
        Characteristic.TargetTemperature,
        setpointParam.value,
      );
    }

    this.thermostatService.updateCharacteristic(
      Characteristic.TargetHeatingCoolingState,
      this.isActiveState(state.stato)
        ? Characteristic.TargetHeatingCoolingState.HEAT
        : Characteristic.TargetHeatingCoolingState.OFF,
    );

    // Room temperature sensor (created dynamically on first data)
    const roomSensor = state.sensors.get(SENSOR_ROOM_TEMP);
    if (roomSensor) {
      if (!this.roomTempService) {
        this.createRoomTempService();
      }
      const roomTemp = applyPosPunto(roomSensor.valore, state.posPunto);
      this.roomTempService!.updateCharacteristic(
        Characteristic.CurrentTemperature,
        roomTemp,
      );
    }
  }

  private createRoomTempService() {
    const { Service, Characteristic } = this.platform;
    this.roomTempService = this.accessory.getService('Room Temperature')
      ?? this.accessory.addService(Service.TemperatureSensor, 'Room Temperature', 'room-temp');

    this.roomTempService.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: -40, maxValue: 100, minStep: 0.1 })
      .onGet(() => {
        const sensor = this.platform.deviceState?.sensors.get(SENSOR_ROOM_TEMP);
        if (sensor && this.platform.deviceState) {
          return applyPosPunto(sensor.valore, this.platform.deviceState.posPunto);
        }
        return 0;
      });

    this.thermostatService.addLinkedService(this.roomTempService);
    this.platform.log.info('Room temperature sensor detected, service created');
  }

  private mapCurrentState(stato: number): number {
    const { Characteristic } = this.platform;
    if (StoveAccessory.HEATING_STATES.has(stato)) {
      return Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    return Characteristic.CurrentHeatingCoolingState.OFF;
  }

  private isActiveState(stato: number): boolean {
    return stato !== STATO.OFF && stato !== STATO.EXTINGUISHING;
  }

  private isInFaultState(stato: number): boolean {
    return stato === STATO.BLOCK || stato === STATO.SAFETY_MODE;
  }

  private getCurrentHeatingState(): number {
    const stato = this.platform.deviceState?.stato ?? 0;
    return this.mapCurrentState(stato);
  }

  private getTargetHeatingState(): number {
    const { Characteristic } = this.platform;
    const stato = this.platform.deviceState?.stato ?? 0;
    return this.isActiveState(stato)
      ? Characteristic.TargetHeatingCoolingState.HEAT
      : Characteristic.TargetHeatingCoolingState.OFF;
  }

  private async setTargetHeatingState(value: CharacteristicValue) {
    const { Characteristic } = this.platform;
    if (value === Characteristic.TargetHeatingCoolingState.HEAT) {
      this.platform.log.info('Turning stove ON');
      await this.platform.turnOn();
    } else {
      this.platform.log.info('Turning stove OFF');
      await this.platform.turnOff();
    }
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
    return this.isInFaultState(stato)
      ? Characteristic.StatusFault.GENERAL_FAULT
      : Characteristic.StatusFault.NO_FAULT;
  }
}
