import { STATO_LABELS, ERROR_CODES } from './types.js';
import { PLATFORM_NAME, PLUGIN_NAME, DEFAULT_PORT, DEFAULT_POLLING_INTERVAL, DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP } from './settings.js';
import { FourHeatClient } from './client.js';
import { wakeAndDiscover } from './udp.js';
import { StoveAccessory } from './stoveAccessory.js';
const BACKOFF_STEPS = [5, 10, 30, 60];
export class FourHeatPlatform {
    log;
    api;
    Service;
    Characteristic;
    config;
    client;
    deviceState = null;
    cachedAccessories = new Map();
    stoveAccessory = null;
    pollingTimer = null;
    consecutiveFailures = 0;
    backoffTimer = null;
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.config = config;
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
        const host = this.config.host;
        const port = this.config.port ?? DEFAULT_PORT;
        if (!host) {
            this.log.info('No host configured, discovering device via UDP broadcast...');
            const device = await wakeAndDiscover();
            if (device) {
                this.log.info('Discovered 4HEAT device: %s (%s) at %s', device.name, device.id, device.ip);
                this.client = new FourHeatClient(this.log, device.ip, port);
                this.registerAccessory(device.id);
            }
            else {
                this.log.error('No 4HEAT device found on the network. Configure "host" manually.');
                return;
            }
        }
        else {
            this.log.info('Using configured host: %s:%d', host, port);
            this.client = new FourHeatClient(this.log, host, port);
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
    startPolling() {
        const interval = (this.config.pollingInterval ?? DEFAULT_POLLING_INTERVAL) * 1000;
        this.poll();
        this.pollingTimer = setInterval(() => this.poll(), interval);
    }
    async poll() {
        try {
            const state = await this.client.readStatus();
            if (state) {
                if (this.consecutiveFailures > 0) {
                    this.log.info('Connection restored after %d failures', this.consecutiveFailures);
                }
                this.consecutiveFailures = 0;
                this.deviceState = state;
                this.stoveAccessory?.updateState(state);
                if (state.errore > 0) {
                    const errorDesc = ERROR_CODES[state.errore] ?? 'Unknown error';
                    this.log.warn('Stove error %d: %s (state=%s)', state.errore, errorDesc, STATO_LABELS[state.stato] ?? state.stato);
                }
                else {
                    this.log.debug('Poll OK: stato=%s, temp=%.1f°C', STATO_LABELS[state.stato] ?? state.stato, state.tempPrinc);
                }
            }
            else {
                this.handlePollFailure();
            }
        }
        catch (err) {
            this.log.debug('Poll exception: %s', err);
            this.handlePollFailure();
        }
    }
    handlePollFailure() {
        this.consecutiveFailures++;
        const backoffIndex = Math.min(this.consecutiveFailures - 1, BACKOFF_STEPS.length - 1);
        const backoffSeconds = BACKOFF_STEPS[backoffIndex];
        this.log.warn('Poll failed (%d consecutive). Next retry in %ds.', this.consecutiveFailures, backoffSeconds);
        // Schedule an extra retry with backoff (in addition to the regular interval)
        if (this.backoffTimer)
            clearTimeout(this.backoffTimer);
        this.backoffTimer = setTimeout(() => this.poll(), backoffSeconds * 1000);
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
    get minTemp() {
        return this.config.minTemp ?? DEFAULT_MIN_TEMP;
    }
    get maxTemp() {
        return this.config.maxTemp ?? DEFAULT_MAX_TEMP;
    }
}
//# sourceMappingURL=platform.js.map