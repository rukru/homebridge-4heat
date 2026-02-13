import { PARAM_TEMP_SETPOINT, STATO, ERROR_CODES, SENSOR_ROOM_TEMP } from './types.js';
import { applyPosPunto } from './protocol.js';
export class StoveAccessory {
    platform;
    accessory;
    static HEATING_STATES = new Set([
        STATO.CHECK_UP,
        STATO.IGNITION,
        STATO.STABILISATION,
        STATO.RETRY_IGNITION,
        STATO.RUN_MODE,
        STATO.MODULATION,
        STATO.RECOVER_IGNITION,
    ]);
    static TARGET_OVERRIDE_TTL = 60_000; // 60s
    thermostatService;
    defaultName;
    roomTempService = null;
    targetOverride = null;
    targetOverrideExpiry = 0;
    constructor(platform, accessory) {
        this.platform = platform;
        this.accessory = accessory;
        const { Service, Characteristic } = platform;
        this.defaultName = platform.config.name || '4HEAT Stove';
        accessory.getService(Service.AccessoryInformation)
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
    updateState(state) {
        const { Characteristic } = this.platform;
        this.thermostatService.updateCharacteristic(Characteristic.CurrentTemperature, state.tempPrinc);
        this.thermostatService.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.mapCurrentState(state.stato));
        this.thermostatService.updateCharacteristic(Characteristic.StatusFault, this.isInFaultState(state.stato)
            ? Characteristic.StatusFault.GENERAL_FAULT
            : Characteristic.StatusFault.NO_FAULT);
        // Update name to show error info or restore default
        if (this.isInFaultState(state.stato) && state.errore > 0) {
            const errorDesc = ERROR_CODES[state.errore] ?? 'Unknown';
            this.thermostatService.updateCharacteristic(Characteristic.Name, `Error ${state.errore}: ${errorDesc}`);
        }
        else {
            this.thermostatService.updateCharacteristic(Characteristic.Name, this.defaultName);
        }
        const setpointParam = state.parameters.get(PARAM_TEMP_SETPOINT);
        if (setpointParam) {
            this.thermostatService.updateCharacteristic(Characteristic.TargetTemperature, setpointParam.value);
        }
        const derivedTarget = this.isActiveState(state.stato)
            ? Characteristic.TargetHeatingCoolingState.HEAT
            : Characteristic.TargetHeatingCoolingState.OFF;
        if (this.targetOverride !== null) {
            if (derivedTarget === this.targetOverride || Date.now() > this.targetOverrideExpiry) {
                this.targetOverride = null;
            }
        }
        this.thermostatService.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.targetOverride ?? derivedTarget);
        // Room temperature sensor (created dynamically on first data)
        const roomSensor = state.sensors.get(SENSOR_ROOM_TEMP);
        if (roomSensor) {
            if (!this.roomTempService) {
                this.createRoomTempService();
            }
            const roomTemp = applyPosPunto(roomSensor.valore, state.posPunto);
            this.roomTempService.updateCharacteristic(Characteristic.CurrentTemperature, roomTemp);
        }
    }
    createRoomTempService() {
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
    mapCurrentState(stato) {
        const { Characteristic } = this.platform;
        if (StoveAccessory.HEATING_STATES.has(stato)) {
            return Characteristic.CurrentHeatingCoolingState.HEAT;
        }
        return Characteristic.CurrentHeatingCoolingState.OFF;
    }
    isActiveState(stato) {
        return stato !== STATO.OFF && stato !== STATO.EXTINGUISHING;
    }
    isInFaultState(stato) {
        return stato === STATO.BLOCK || stato === STATO.SAFETY_MODE;
    }
    getCurrentHeatingState() {
        const stato = this.platform.deviceState?.stato ?? 0;
        return this.mapCurrentState(stato);
    }
    getTargetHeatingState() {
        const { Characteristic } = this.platform;
        if (this.targetOverride !== null && Date.now() <= this.targetOverrideExpiry) {
            return this.targetOverride;
        }
        const stato = this.platform.deviceState?.stato ?? 0;
        return this.isActiveState(stato)
            ? Characteristic.TargetHeatingCoolingState.HEAT
            : Characteristic.TargetHeatingCoolingState.OFF;
    }
    async setTargetHeatingState(value) {
        const { Characteristic } = this.platform;
        const target = value;
        this.targetOverride = target;
        this.targetOverrideExpiry = Date.now() + StoveAccessory.TARGET_OVERRIDE_TTL;
        if (target === Characteristic.TargetHeatingCoolingState.HEAT) {
            this.platform.log.info('Turning stove ON');
            await this.platform.turnOn();
        }
        else {
            this.platform.log.info('Turning stove OFF');
            await this.platform.turnOff();
        }
    }
    getCurrentTemperature() {
        return this.platform.deviceState?.tempPrinc ?? 0;
    }
    getTargetTemperature() {
        const param = this.platform.deviceState?.parameters.get(PARAM_TEMP_SETPOINT);
        return param?.value ?? this.platform.minTemp;
    }
    async setTargetTemperature(value) {
        const temp = value;
        this.platform.log.info('Setting target temperature to %d°C', temp);
        await this.platform.writeParameter(PARAM_TEMP_SETPOINT, temp);
    }
    getStatusFault() {
        const { Characteristic } = this.platform;
        const stato = this.platform.deviceState?.stato ?? 0;
        return this.isInFaultState(stato)
            ? Characteristic.StatusFault.GENERAL_FAULT
            : Characteristic.StatusFault.NO_FAULT;
    }
}
//# sourceMappingURL=stoveAccessory.js.map