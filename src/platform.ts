import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  Service,
  Characteristic,
} from 'homebridge';
import type { FourHeatConfig, DeviceState } from './types.js';
import { PARAM_TEMP_SETPOINT, STATO, STATO_LABELS, ERROR_CODES } from './types.js';
import { PLATFORM_NAME, PLUGIN_NAME, DEFAULT_PORT, DEFAULT_POLLING_INTERVAL, DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP } from './settings.js';
import { FourHeatClient } from './client.js';
import { wakeAndDiscover } from './udp.js';
import { StoveAccessory } from './stoveAccessory.js';

const BACKOFF_STEPS = [5, 10, 30, 60];

export class FourHeatPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly config: FourHeatConfig;

  public client!: FourHeatClient;
  public deviceState: DeviceState | null = null;

  private readonly cachedAccessories: Map<string, PlatformAccessory> = new Map();
  private stoveAccessory: StoveAccessory | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly log: Logging,
    config: FourHeatConfig,
    public readonly api: API,
  ) {
    this.config = config;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    if (!config.platform) {
      this.log.error('Missing platform configuration');
      return;
    }

    this.api.on('didFinishLaunching', () => this.didFinishLaunching());
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private async didFinishLaunching() {
    const host = this.config.host;
    const port = this.config.port ?? DEFAULT_PORT;

    if (!host) {
      this.log.info('No host configured, discovering device via UDP broadcast...');
      const device = await wakeAndDiscover();
      if (device) {
        this.log.info('Discovered 4HEAT device: %s (%s) at %s', device.name, device.id, device.ip);
        this.client = new FourHeatClient(this.log, device.ip, port);
        this.registerAccessory(device.id);
      } else {
        this.log.error('No 4HEAT device found on the network. Configure "host" manually.');
        return;
      }
    } else {
      this.log.info('Using configured host: %s:%d', host, port);
      this.client = new FourHeatClient(this.log, host, port);
      this.registerAccessory(host);
    }

    this.startPolling();
  }

  private registerAccessory(identifier: string) {
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${identifier}`);
    const name = this.config.name || '4HEAT Stove';

    let accessory = this.cachedAccessories.get(uuid);
    if (accessory) {
      this.log.info('Restoring cached accessory: %s', name);
    } else {
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

  private startPolling() {
    const interval = (this.config.pollingInterval ?? DEFAULT_POLLING_INTERVAL) * 1000;
    this.poll();
    this.pollingTimer = setInterval(() => this.poll(), interval);
  }

  private async poll() {
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

        const params: string[] = [];
        for (const [id, p] of state.parameters) {
          params.push(`0x${id.toString(16)}=${p.value}`);
        }
        const sensors: string[] = [];
        for (const [id, s] of state.sensors) {
          sensors.push(`0x${id.toString(16)}=${s.valore}`);
        }
        this.log.info(
          'Poll: state=%s temp=%.1f°C err=%d params=[%s] sensors=[%s]',
          STATO_LABELS[state.stato] ?? state.stato,
          state.tempPrinc,
          state.errore,
          params.join(', '),
          sensors.join(', '),
        );
      } else {
        this.handlePollFailure();
      }
    } catch (err) {
      this.log.warn('Poll exception: %s', err);
      this.handlePollFailure();
    }
  }

  private handlePollFailure() {
    this.consecutiveFailures++;
    const backoffIndex = Math.min(this.consecutiveFailures - 1, BACKOFF_STEPS.length - 1);
    const backoffSeconds = BACKOFF_STEPS[backoffIndex];
    this.log.warn('Poll failed (%d consecutive). Next retry in %ds.', this.consecutiveFailures, backoffSeconds);

    // Schedule an extra retry with backoff (in addition to the regular interval)
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.backoffTimer = setTimeout(() => this.poll(), backoffSeconds * 1000);
  }

  async writeParameter(paramId: number, value: number): Promise<boolean> {
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

  async turnOn(): Promise<boolean> {
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

  async turnOff(): Promise<boolean> {
    const success = await this.client.turnOff();
    if (success) {
      await this.poll();
    }
    return success;
  }

  async resetError(): Promise<boolean> {
    const success = await this.client.resetError();
    if (success) {
      await this.poll();
    }
    return success;
  }

  get minTemp(): number {
    return this.config.minTemp ?? DEFAULT_MIN_TEMP;
  }

  get maxTemp(): number {
    return this.config.maxTemp ?? DEFAULT_MAX_TEMP;
  }
}
