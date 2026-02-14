import { createRequire } from 'node:module';
import { STATO, STATO_LABELS, ERROR_CODES, SENSOR_DEFINITIONS, CRONO_PERIODO_LABELS } from './types.js';
import { buildCCSDisableCommand, buildCCSFromSchedule } from './protocol.js';
import { PLATFORM_NAME, PLUGIN_NAME, DEFAULT_PORT, DEFAULT_POLLING_INTERVAL, DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP } from './settings.js';
import { FourHeatClient } from './client.js';
import { wakeAndDiscover } from './udp.js';
import { StoveAccessory } from './stoveAccessory.js';
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require('../package.json');
const BACKOFF_STEPS = [5, 10, 30, 60];
export class FourHeatPlatform {
    log;
    api;
    Service;
    Characteristic;
    config;
    client;
    deviceState = null;
    logLevel;
    cachedAccessories = new Map();
    stoveAccessory = null;
    pollingTimer = null;
    consecutiveFailures = 0;
    backoffTimer = null;
    cachedSchedule = null;
    originalPeriodo = null;
    pollCount = 0;
    static CCG_POLL_INTERVAL = 10;
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.config = config;
        const validLevels = new Set(['normal', 'verbose', 'debug']);
        this.logLevel = validLevels.has(config.logLevel ?? '') ? config.logLevel : 'normal';
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        if (!config.platform) {
            this.log.error('Missing platform configuration');
            return;
        }
        this.api.on('didFinishLaunching', () => this.didFinishLaunching());
    }
    configureAccessory(accessory) {
        this.cachedAccessories.set(accessory.UUID, accessory);
    }
    async didFinishLaunching() {
        this.log.info('Starting homebridge-4heat v%s', PLUGIN_VERSION);
        const sensorsConfig = this.config.sensors ?? {};
        const enabledSensors = SENSOR_DEFINITIONS.filter(s => sensorsConfig[s.configKey]);
        if (enabledSensors.length > 0) {
            this.log.info('Enabled sensors: %s', enabledSensors.map(s => s.displayName).join(', '));
        }
        if (this.config.cronoSwitch) {
            this.log.info('Crono schedule switch enabled');
        }
        const host = this.config.host;
        const port = this.config.port ?? DEFAULT_PORT;
        if (!host) {
            this.log.info('No host configured, discovering device via UDP broadcast...');
            const device = await wakeAndDiscover();
            if (device) {
                this.log.info('Discovered 4HEAT device: %s (%s) at %s', device.name, device.id, device.ip);
                this.client = new FourHeatClient(this.log, device.ip, port, { debugTcp: this.logLevel === 'debug' });
                this.registerAccessory(device.id);
            }
            else {
                this.log.error('No 4HEAT device found on the network. Configure "host" manually.');
                return;
            }
        }
        else {
            this.log.info('Using configured host: %s:%d', host, port);
            this.client = new FourHeatClient(this.log, host, port, { debugTcp: this.logLevel === 'debug' });
            this.registerAccessory(host);
        }
        this.startPolling();
    }
    registerAccessory(identifier) {
        const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${identifier}`);
        const name = this.config.name || '4HEAT Stove';
        let accessory = this.cachedAccessories.get(uuid);
        if (accessory) {
            this.log.info('Restoring cached accessory: %s', name);
        }
        else {
            this.log.info('Adding new accessory: %s', name);
            accessory = new this.api.platformAccessory(name, uuid);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
        this.stoveAccessory = new StoveAccessory(this, accessory);
        // Unregister any stale cached accessories
        for (const [cachedUuid, cachedAccessory] of this.cachedAccessories) {
            if (cachedUuid !== uuid) {
                this.log.info('Removing stale accessory: %s', cachedAccessory.displayName);
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
            }
        }
    }
    get pollingIntervalMs() {
        return (this.config.pollingInterval ?? DEFAULT_POLLING_INTERVAL) * 1000;
    }
    startPolling() {
        this.poll();
        this.pollingTimer = setInterval(() => this.poll(), this.pollingIntervalMs);
    }
    scheduleRetry(delayMs) {
        if (this.backoffTimer)
            clearTimeout(this.backoffTimer);
        this.backoffTimer = setTimeout(() => this.poll(), delayMs);
    }
    stopTimers() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
        if (this.backoffTimer) {
            clearTimeout(this.backoffTimer);
            this.backoffTimer = null;
        }
    }
    async poll() {
        try {
            const state = await this.client.readStatus();
            if (state) {
                if (this.consecutiveFailures > 0) {
                    this.log.info('Connection restored after %d failures', this.consecutiveFailures);
                    // Restore regular interval after backoff recovery
                    this.stopTimers();
                    this.pollingTimer = setInterval(() => this.poll(), this.pollingIntervalMs);
                }
                this.consecutiveFailures = 0;
                this.deviceState = state;
                this.stoveAccessory?.updateState(state);
                if (this.config.cronoSwitch) {
                    this.pollCount++;
                    if (this.cachedSchedule === null || this.pollCount % FourHeatPlatform.CCG_POLL_INTERVAL === 0) {
                        await this.refreshSchedule();
                    }
                    this.stoveAccessory?.updateCronoState(state, this.cachedSchedule);
                }
                if (state.errore > 0) {
                    const errorDesc = ERROR_CODES[state.errore] ?? 'Unknown error';
                    this.log.warn('Stove error %d: %s (state=%s)', state.errore, errorDesc, STATO_LABELS[state.stato] ?? state.stato);
                }
                if (this.logLevel !== 'normal') {
                    const params = [];
                    for (const [id, p] of state.parameters) {
                        params.push(`0x${id.toString(16)}=${p.value}`);
                    }
                    const sensors = [];
                    for (const [id, s] of state.sensors) {
                        sensors.push(`0x${id.toString(16)}=${s.valore}`);
                    }
                    const tempStr = state.tempPrinc.toFixed(1);
                    this.log.info('Poll: state=%s temp=%s°C err=%d params=[%s] sensors=[%s]', STATO_LABELS[state.stato] ?? String(state.stato), tempStr, state.errore, params.join(', '), sensors.join(', '));
                }
            }
            else {
                this.handlePollFailure();
            }
        }
        catch (err) {
            this.log.warn('Poll exception: %s', err);
            this.handlePollFailure();
        }
    }
    handlePollFailure() {
        this.consecutiveFailures++;
        const backoffIndex = Math.min(this.consecutiveFailures - 1, BACKOFF_STEPS.length - 1);
        const backoffSeconds = BACKOFF_STEPS[backoffIndex];
        this.log.warn('Poll failed (%d consecutive). Next retry in %ds.', this.consecutiveFailures, backoffSeconds);
        // Pause regular polling and switch to backoff-only retries
        this.stopTimers();
        this.scheduleRetry(backoffSeconds * 1000);
    }
    async writeParameter(paramId, value) {
        const param = this.deviceState?.parameters.get(paramId);
        if (!param) {
            this.log.warn('Parameter 0x%s not found in device state', paramId.toString(16));
            return false;
        }
        const success = await this.client.writeParameter(param.originalHex, value);
        if (success) {
            // Refresh state after write
            await this.poll();
        }
        return success;
    }
    async turnOn() {
        if (this.deviceState?.stato === STATO.BLOCK) {
            this.log.info('Stove is blocked, resetting error before turning on...');
            await this.client.resetError();
            await this.poll();
            if (this.deviceState?.stato === STATO.BLOCK) {
                this.log.warn('Error reset failed, stove still blocked');
                return false;
            }
            this.log.info('Error reset successful, turning on...');
        }
        const success = await this.client.turnOn();
        if (success) {
            await this.poll();
        }
        return success;
    }
    async turnOff() {
        const success = await this.client.turnOff();
        if (success) {
            await this.poll();
        }
        return success;
    }
    async resetError() {
        const success = await this.client.resetError();
        if (success) {
            await this.poll();
        }
        return success;
    }
    async refreshSchedule() {
        try {
            const schedule = await this.client.readSchedule();
            if (schedule) {
                if (schedule.periodo !== 0) {
                    this.originalPeriodo = schedule.periodo;
                }
                this.cachedSchedule = schedule;
                if (this.logLevel !== 'normal') {
                    this.log.info('Schedule refreshed: periodo=%s (saved=%s)', CRONO_PERIODO_LABELS[schedule.periodo] ?? String(schedule.periodo), this.originalPeriodo !== null ? (CRONO_PERIODO_LABELS[this.originalPeriodo] ?? String(this.originalPeriodo)) : 'none');
                }
            }
        }
        catch (err) {
            this.log.warn('Failed to read schedule: %s', err);
        }
    }
    async enableCrono() {
        if (!this.cachedSchedule) {
            await this.refreshSchedule();
        }
        if (!this.cachedSchedule) {
            this.log.warn('Cannot enable crono: no schedule data available');
            return false;
        }
        const periodo = this.cachedSchedule.periodo !== 0
            ? this.cachedSchedule.periodo
            : this.originalPeriodo;
        if (!periodo) {
            this.log.warn('Cannot enable crono: no schedule configured. Use the 4HEAT app to set up a schedule first.');
            return false;
        }
        this.log.info('Enabling crono (periodo=%s)', CRONO_PERIODO_LABELS[periodo] ?? String(periodo));
        const cmd = buildCCSFromSchedule(this.cachedSchedule, periodo);
        const success = await this.client.writeSchedule(cmd);
        if (success) {
            await this.refreshSchedule();
            await this.poll();
        }
        return success;
    }
    async disableCrono() {
        if (!this.cachedSchedule) {
            await this.refreshSchedule();
        }
        if (!this.cachedSchedule) {
            this.log.warn('Cannot disable crono: no schedule data available');
            return false;
        }
        this.log.info('Disabling crono');
        const cmd = buildCCSDisableCommand(this.cachedSchedule);
        const success = await this.client.writeSchedule(cmd);
        if (success) {
            await this.refreshSchedule();
            await this.poll();
        }
        return success;
    }
    get schedule() {
        return this.cachedSchedule;
    }
    get minTemp() {
        return this.config.minTemp ?? DEFAULT_MIN_TEMP;
    }
    get maxTemp() {
        return this.config.maxTemp ?? DEFAULT_MAX_TEMP;
    }
}
//# sourceMappingURL=platform.js.map