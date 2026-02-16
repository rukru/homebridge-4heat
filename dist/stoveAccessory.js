import { PARAM_TEMP_SETPOINT, STATO, ERROR_CODES, SENSOR_DEFINITIONS, STATO_CRONO } from './types.js';
import { applyPosPunto } from './protocol.js';
import { DEFAULT_SWITCH_DEBOUNCE } from './settings.js';
export class StoveAccessory {
    platform;
    accessory;
    /** Throw in onGet to signal "No Response" in HomeKit */
    throwIfUnreachable() {
        if (this.platform.isDeviceUnreachable) {
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
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
    sensorServices = new Map();
    cronoSwitchService = null;
    cronoDefaultName = 'Schedule';
    alertSensorService = null;
    targetOverride = null;
    targetOverrideExpiry = 0;
    switchDebounceTimer = null;
    pendingSwitchTarget = null;
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
            .onGet(() => {
            this.throwIfUnreachable();
            return Characteristic.TemperatureDisplayUnits.CELSIUS;
        });
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
        // --- Crono switch service ---
        if (platform.config.cronoSwitch) {
            this.setupCronoSwitch();
        }
        else {
            const staleSwitch = accessory.getServiceById(Service.Switch, 'crono-switch');
            if (staleSwitch) {
                accessory.removeService(staleSwitch);
                platform.log.info('Removed disabled crono switch service');
            }
        }
        // --- Alert sensor (SmokeSensor) ---
        if (platform.config.alertSensor) {
            this.setupAlertSensor();
        }
        else {
            const staleSensor = accessory.getServiceById(Service.SmokeSensor, 'alert-sensor');
            if (staleSensor) {
                accessory.removeService(staleSensor);
                platform.log.info('Removed disabled alert sensor service');
            }
        }
    }
    setupSensorServices() {
        const sensorsConfig = this.platform.config.sensors ?? {};
        const enabledSubtypes = new Set();
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
    createSensorService(meta) {
        const { Service, Characteristic } = this.platform;
        let service = this.accessory.getServiceById(this.getHAPServiceType(meta.serviceType), meta.subtype);
        if (!service) {
            service = this.accessory.addService(this.getHAPServiceType(meta.serviceType), meta.displayName, meta.subtype);
        }
        if (meta.serviceType === 'TemperatureSensor') {
            service.getCharacteristic(Characteristic.CurrentTemperature)
                .setProps({ minValue: -40, maxValue: 1000, minStep: 0.1 })
                .onGet(() => this.getSensorValue(meta));
        }
        else if (meta.serviceType === 'HumiditySensor') {
            service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                .onGet(() => this.getSensorValue(meta));
        }
        else if (meta.serviceType === 'LightSensor') {
            service.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                .setProps({ minValue: 0.0001, maxValue: 100000 })
                .onGet(() => this.getSensorValue(meta));
        }
        this.thermostatService.addLinkedService(service);
        this.sensorServices.set(meta.id, { service, meta });
        this.platform.log.info('Sensor service created: %s', meta.displayName);
    }
    getHAPServiceType(serviceType) {
        const { Service } = this.platform;
        switch (serviceType) {
            case 'TemperatureSensor': return Service.TemperatureSensor;
            case 'HumiditySensor': return Service.HumiditySensor;
            case 'LightSensor': return Service.LightSensor;
            default: return Service.TemperatureSensor;
        }
    }
    getSensorValue(meta) {
        this.throwIfUnreachable();
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
            if (range <= 0)
                return 0;
            const pct = ((raw - sensor.min) / range) * 100;
            return Math.max(0, Math.min(100, pct));
        }
        if (meta.serviceType === 'LightSensor') {
            return Math.max(0.0001, raw);
        }
        return raw;
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
        // Update alert sensor
        if (this.alertSensorService) {
            const smokeDetected = this.isInFaultState(state.stato)
                ? Characteristic.SmokeDetected.SMOKE_DETECTED
                : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
            this.alertSensorService.updateCharacteristic(Characteristic.SmokeDetected, smokeDetected);
            this.alertSensorService.updateCharacteristic(Characteristic.StatusFault, this.isInFaultState(state.stato)
                ? Characteristic.StatusFault.GENERAL_FAULT
                : Characteristic.StatusFault.NO_FAULT);
            if (this.isInFaultState(state.stato) && state.errore > 0) {
                const errorDesc = ERROR_CODES[state.errore] ?? 'Unknown';
                this.alertSensorService.updateCharacteristic(Characteristic.Name, `Error ${state.errore}: ${errorDesc}`);
            }
            else {
                this.alertSensorService.updateCharacteristic(Characteristic.Name, 'Stove Alert');
            }
        }
        // Update crono switch on/off state (name is updated separately via updateCronoState)
        if (this.cronoSwitchService) {
            const cronoOn = state.statoCrono !== STATO_CRONO.OFF && state.statoCrono !== 0;
            this.cronoSwitchService.updateCharacteristic(Characteristic.On, cronoOn);
        }
        // Update sensor services
        for (const [sensorId, { service, meta }] of this.sensorServices) {
            const sensor = state.sensors.get(sensorId);
            if (!sensor)
                continue;
            if (meta.serviceType === 'TemperatureSensor') {
                const temp = applyPosPunto(sensor.valore, state.posPunto);
                service.updateCharacteristic(Characteristic.CurrentTemperature, temp);
            }
            else if (meta.serviceType === 'HumiditySensor') {
                const range = sensor.max - sensor.min;
                const pct = range > 0 ? ((sensor.valore - sensor.min) / range) * 100 : 0;
                service.updateCharacteristic(Characteristic.CurrentRelativeHumidity, Math.max(0, Math.min(100, pct)));
            }
            else if (meta.serviceType === 'LightSensor') {
                service.updateCharacteristic(Characteristic.CurrentAmbientLightLevel, Math.max(0.0001, sensor.valore));
            }
        }
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
        this.throwIfUnreachable();
        const stato = this.platform.deviceState?.stato ?? 0;
        return this.mapCurrentState(stato);
    }
    getTargetHeatingState() {
        this.throwIfUnreachable();
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
        }
        else {
            await this.executeSwitchCommand(target);
        }
    }
    async executeSwitchCommand(target) {
        const { Characteristic } = this.platform;
        let success;
        if (target === Characteristic.TargetHeatingCoolingState.HEAT) {
            this.platform.log.info('Turning stove ON');
            success = await this.platform.turnOn();
        }
        else {
            this.platform.log.info('Turning stove OFF');
            success = await this.platform.turnOff();
        }
        if (!success) {
            this.targetOverride = null;
            this.thermostatService.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.deriveTargetFromState());
        }
    }
    deriveTargetFromState() {
        const { Characteristic } = this.platform;
        const stato = this.platform.deviceState?.stato ?? 0;
        return this.isActiveState(stato)
            ? Characteristic.TargetHeatingCoolingState.HEAT
            : Characteristic.TargetHeatingCoolingState.OFF;
    }
    getCurrentTemperature() {
        this.throwIfUnreachable();
        return this.platform.deviceState?.tempPrinc ?? 0;
    }
    getTargetTemperature() {
        this.throwIfUnreachable();
        const param = this.platform.deviceState?.parameters.get(PARAM_TEMP_SETPOINT);
        return param?.value ?? this.platform.minTemp;
    }
    async setTargetTemperature(value) {
        const temp = value;
        this.platform.log.info('Setting target temperature to %d°C', temp);
        await this.platform.writeParameter(PARAM_TEMP_SETPOINT, temp);
    }
    getStatusFault() {
        this.throwIfUnreachable();
        const { Characteristic } = this.platform;
        const stato = this.platform.deviceState?.stato ?? 0;
        return this.isInFaultState(stato)
            ? Characteristic.StatusFault.GENERAL_FAULT
            : Characteristic.StatusFault.NO_FAULT;
    }
    // --- Alert sensor (SmokeSensor) ---
    setupAlertSensor() {
        const { Service, Characteristic } = this.platform;
        let service = this.accessory.getServiceById(Service.SmokeSensor, 'alert-sensor');
        if (!service) {
            service = this.accessory.addService(Service.SmokeSensor, 'Stove Alert', 'alert-sensor');
        }
        service.getCharacteristic(Characteristic.SmokeDetected)
            .onGet(() => this.getSmokeDetected());
        service.addOptionalCharacteristic(Characteristic.StatusFault);
        service.getCharacteristic(Characteristic.StatusFault)
            .onGet(() => this.getStatusFault());
        this.thermostatService.addLinkedService(service);
        this.alertSensorService = service;
        this.platform.log.info('Alert sensor service created');
    }
    getSmokeDetected() {
        this.throwIfUnreachable();
        const { Characteristic } = this.platform;
        const stato = this.platform.deviceState?.stato ?? 0;
        return this.isInFaultState(stato)
            ? Characteristic.SmokeDetected.SMOKE_DETECTED
            : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
    }
    // --- Crono (schedule) switch ---
    setupCronoSwitch() {
        const { Service, Characteristic } = this.platform;
        const cronoName = this.platform.config.cronoName || 'Schedule';
        let service = this.accessory.getServiceById(Service.Switch, 'crono-switch');
        if (!service) {
            service = this.accessory.addService(Service.Switch, cronoName, 'crono-switch');
        }
        service.setCharacteristic(Characteristic.Name, cronoName);
        service.getCharacteristic(Characteristic.On)
            .onGet(() => this.getCronoOn())
            .onSet((value) => this.setCronoOn(value));
        this.thermostatService.addLinkedService(service);
        this.cronoSwitchService = service;
        this.cronoDefaultName = cronoName;
        this.platform.log.info('Crono switch service created: %s', cronoName);
    }
    getCronoOn() {
        this.throwIfUnreachable();
        const statoCrono = this.platform.deviceState?.statoCrono ?? STATO_CRONO.OFF;
        return statoCrono !== STATO_CRONO.OFF && statoCrono !== 0;
    }
    async setCronoOn(value) {
        const on = value;
        let success;
        if (on) {
            this.platform.log.info('Enabling crono schedule');
            success = await this.platform.enableCrono();
        }
        else {
            this.platform.log.info('Disabling crono schedule');
            success = await this.platform.disableCrono();
        }
        if (!success) {
            setTimeout(() => {
                this.cronoSwitchService?.updateCharacteristic(this.platform.Characteristic.On, this.getCronoOn());
            }, 500);
        }
    }
    updateCronoState(state, schedule) {
        if (!this.cronoSwitchService)
            return;
        const { Characteristic } = this.platform;
        const cronoOn = state.statoCrono !== STATO_CRONO.OFF && state.statoCrono !== 0;
        this.cronoSwitchService.updateCharacteristic(Characteristic.On, cronoOn);
        if (cronoOn && schedule && schedule.periodo !== 0) {
            const nextEvent = this.calculateNextEvent(schedule);
            if (nextEvent) {
                this.cronoSwitchService.updateCharacteristic(Characteristic.Name, `${this.cronoDefaultName}: ${nextEvent}`);
            }
            else {
                this.cronoSwitchService.updateCharacteristic(Characteristic.Name, this.cronoDefaultName);
            }
        }
        else {
            this.cronoSwitchService.updateCharacteristic(Characteristic.Name, this.cronoDefaultName);
        }
    }
    calculateNextEvent(schedule) {
        if (schedule.periodo === 0)
            return null;
        const now = new Date();
        const jsDay = now.getDay(); // 0=Sun, 1=Mon
        const deviceDay = jsDay === 0 ? 7 : jsDay; // 1=Mon ... 7=Sun
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${hh}:${mm}`;
        const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const getRelevantDay = (dayNum) => {
            if (schedule.periodo === 2)
                return schedule.days[0];
            if (schedule.periodo === 3)
                return dayNum >= 6 ? schedule.days[5] : schedule.days[0];
            return schedule.days[dayNum - 1];
        };
        for (let offset = 0; offset < 7; offset++) {
            const checkDay = ((deviceDay - 1 + offset) % 7) + 1;
            const daySchedule = getRelevantDay(checkDay);
            if (!daySchedule)
                continue;
            const enabledSlots = daySchedule.slots
                .filter(s => s.enabled && s.start !== '00:00' && s.end !== '00:00')
                .sort((a, b) => a.start.localeCompare(b.start));
            for (const slot of enabledSlots) {
                if (offset === 0) {
                    if (currentTime < slot.start)
                        return `ON ${slot.start}`;
                    if (currentTime >= slot.start && currentTime < slot.end)
                        return `OFF ${slot.end}`;
                }
                else {
                    return `${DAY_LABELS[checkDay - 1]} ON ${slot.start}`;
                }
            }
        }
        return null;
    }
}
//# sourceMappingURL=stoveAccessory.js.map