import type { PlatformAccessory, CharacteristicValue, Service } from 'homebridge';
import type { DeviceState, SensorMeta } from './types.js';
import { PARAM_TEMP_SETPOINT, STATO, ERROR_CODES, SENSOR_DEFINITIONS } from './types.js';
import { applyPosPunto } from './protocol.js';
import type { FourHeatPlatform } from './platform.js';
import { DEFAULT_SWITCH_DEBOUNCE } from './settings.js';

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

  private static readonly TARGET_OVERRIDE_TTL = 60_000; // 60s

  private readonly thermostatService: Service;
  private readonly defaultName: string;
  private readonly sensorServices: Map<number, { service: Service; meta: SensorMeta }> = new Map();
  private targetOverride: number | null = null;
  private targetOverrideExpiry = 0;
  private switchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSwitchTarget: number | null = null;

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

    // Remove legacy "Room Temperature" service from previous version
    const legacyRoomTemp = accessory.getService('Room Temperature');
    if (legacyRoomTemp) {
      accessory.removeService(legacyRoomTemp);
      platform.log.info('Removed legacy Room Temperature service');
    }

    // --- Sensor services ---
    this.setupSensorServices();
  }

  private setupSensorServices() {
    const sensorsConfig = this.platform.config.sensors ?? {};
    const enabledSubtypes = new Set<string>();

    for (const meta of SENSOR_DEFINITIONS) {
      if (sensorsConfig[meta.configKey]) {
        this.createSensorService(meta);
        enabledSubtypes.add(meta.subtype);
      }
    }

    // Remove stale sensor services (disabled but cached from previous config)
    const allSubtypes = new Set(SENSOR_DEFINITIONS.map(m => m.subtype));
    for (const service of this.accessory.services) {
      const subtype = service.subtype;
      if (subtype && allSubtypes.has(subtype) && !enabledSubtypes.has(subtype)) {
        this.accessory.removeService(service);
        this.platform.log.info('Removed disabled sensor service: %s', subtype);
      }
    }
  }

  private createSensorService(meta: SensorMeta) {
    const { Service, Characteristic } = this.platform;

    let service = this.accessory.getServiceById(this.getHAPServiceType(meta.serviceType), meta.subtype);
    if (!service) {
      service = this.accessory.addService(
        this.getHAPServiceType(meta.serviceType),
        meta.displayName,
        meta.subtype,
      );
    }

    if (meta.serviceType === 'TemperatureSensor') {
      service.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -40, maxValue: 1000, minStep: 0.1 })
        .onGet(() => this.getSensorValue(meta));
    } else if (meta.serviceType === 'HumiditySensor') {
      service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .onGet(() => this.getSensorValue(meta));
    } else if (meta.serviceType === 'LightSensor') {
      service.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
        .setProps({ minValue: 0.0001, maxValue: 100000 })
        .onGet(() => this.getSensorValue(meta));
    }

    this.thermostatService.addLinkedService(service);
    this.sensorServices.set(meta.id, { service, meta });
    this.platform.log.info('Sensor service created: %s', meta.displayName);
  }

  private getHAPServiceType(serviceType: string) {
    const { Service } = this.platform;
    switch (serviceType) {
      case 'TemperatureSensor': return Service.TemperatureSensor;
      case 'HumiditySensor': return Service.HumiditySensor;
      case 'LightSensor': return Service.LightSensor;
      default: return Service.TemperatureSensor;
    }
  }

  private getSensorValue(meta: SensorMeta): number {
    const state = this.platform.deviceState;
    const sensor = state?.sensors.get(meta.id);
    if (!sensor || !state) {
      return meta.serviceType === 'LightSensor' ? 0.0001 : 0;
    }

    const raw = sensor.valore;

    if (meta.serviceType === 'TemperatureSensor') {
      return applyPosPunto(raw, state.posPunto);
    }

    if (meta.serviceType === 'HumiditySensor') {
      const range = sensor.max - sensor.min;
      if (range <= 0) return 0;
      const pct = ((raw - sensor.min) / range) * 100;
      return Math.max(0, Math.min(100, pct));
    }

    if (meta.serviceType === 'LightSensor') {
      return Math.max(0.0001, raw);
    }

    return raw;
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

    const derivedTarget = this.isActiveState(state.stato)
      ? Characteristic.TargetHeatingCoolingState.HEAT
      : Characteristic.TargetHeatingCoolingState.OFF;

    if (this.targetOverride !== null) {
      if (derivedTarget === this.targetOverride || Date.now() > this.targetOverrideExpiry) {
        this.targetOverride = null;
      }
    }

    this.thermostatService.updateCharacteristic(
      Characteristic.TargetHeatingCoolingState,
      this.targetOverride ?? derivedTarget,
    );

    // Update sensor services
    for (const [sensorId, { service, meta }] of this.sensorServices) {
      const sensor = state.sensors.get(sensorId);
      if (!sensor) continue;

      if (meta.serviceType === 'TemperatureSensor') {
        const temp = applyPosPunto(sensor.valore, state.posPunto);
        service.updateCharacteristic(Characteristic.CurrentTemperature, temp);
      } else if (meta.serviceType === 'HumiditySensor') {
        const range = sensor.max - sensor.min;
        const pct = range > 0 ? ((sensor.valore - sensor.min) / range) * 100 : 0;
        service.updateCharacteristic(
          Characteristic.CurrentRelativeHumidity,
          Math.max(0, Math.min(100, pct)),
        );
      } else if (meta.serviceType === 'LightSensor') {
        service.updateCharacteristic(
          Characteristic.CurrentAmbientLightLevel,
          Math.max(0.0001, sensor.valore),
        );
      }
    }
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
    if (this.targetOverride !== null && Date.now() <= this.targetOverrideExpiry) {
      return this.targetOverride;
    }
    const stato = this.platform.deviceState?.stato ?? 0;
    return this.isActiveState(stato)
      ? Characteristic.TargetHeatingCoolingState.HEAT
      : Characteristic.TargetHeatingCoolingState.OFF;
  }

  private async setTargetHeatingState(value: CharacteristicValue) {
    const { Characteristic } = this.platform;
    const target = value as number;
    this.targetOverride = target;
    this.targetOverrideExpiry = Date.now() + StoveAccessory.TARGET_OVERRIDE_TTL;

    const debounceSeconds = this.platform.config.switchDebounce ?? DEFAULT_SWITCH_DEBOUNCE;

    if (debounceSeconds > 0) {
      if (this.switchDebounceTimer) {
        clearTimeout(this.switchDebounceTimer);
        const prevLabel = this.pendingSwitchTarget === Characteristic.TargetHeatingCoolingState.HEAT ? 'ON' : 'OFF';
        this.platform.log.info('Debounce: cancelled pending %s command', prevLabel);
      }

      const label = target === Characteristic.TargetHeatingCoolingState.HEAT ? 'ON' : 'OFF';
      this.platform.log.info('Debounce: will turn %s in %ds', label, debounceSeconds);
      this.pendingSwitchTarget = target;

      this.switchDebounceTimer = setTimeout(async () => {
        this.switchDebounceTimer = null;
        this.pendingSwitchTarget = null;
        await this.executeSwitchCommand(target);
      }, debounceSeconds * 1000);
    } else {
      await this.executeSwitchCommand(target);
    }
  }

  private async executeSwitchCommand(target: number) {
    const { Characteristic } = this.platform;
    let success: boolean;

    if (target === Characteristic.TargetHeatingCoolingState.HEAT) {
      this.platform.log.info('Turning stove ON');
      success = await this.platform.turnOn();
    } else {
      this.platform.log.info('Turning stove OFF');
      success = await this.platform.turnOff();
    }

    if (!success) {
      this.targetOverride = null;
      this.thermostatService.updateCharacteristic(
        Characteristic.TargetHeatingCoolingState,
        this.deriveTargetFromState(),
      );
    }
  }

  private deriveTargetFromState(): number {
    const { Characteristic } = this.platform;
    const stato = this.platform.deviceState?.stato ?? 0;
    return this.isActiveState(stato)
      ? Characteristic.TargetHeatingCoolingState.HEAT
      : Characteristic.TargetHeatingCoolingState.OFF;
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
