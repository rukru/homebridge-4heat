/**
 * TCP client for 4HEAT PinKEY device.
 * Each request: UDP wake-up → TCP connect → 500ms delay → send → recv → close.
 * Serialized via promise queue — device cannot handle concurrent connections.
 */

import net from 'node:net';
import type { Logging } from 'homebridge';
import type { DeviceState, ParameterValue, SensorValue } from './types.js';
import { DEFAULT_TIMEOUT, DEFAULT_CONNECT_DELAY } from './settings.js';
import { parse2WLResponse, parseHexDatapoint, build2WCCommand, buildResetCommand, buildStatusCommand, buildOnCommand, buildOffCommand, applyPosPunto } from './protocol.js';
import { wakeAndDiscover } from './udp.js';

export class FourHeatClient {
  private busy = false;
  private queue: Array<{
    cmd: string;
    resolve: (value: string | null) => void;
  }> = [];

  constructor(
    private readonly log: Logging,
    private host: string | undefined,
    private readonly port: number,
    private readonly timeout: number = DEFAULT_TIMEOUT,
    private readonly connectDelay: number = DEFAULT_CONNECT_DELAY,
  ) {}

  get currentHost(): string | undefined {
    return this.host;
  }

  private sendTcp(cmd: string, host: string): Promise<string | null> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let data = '';
      let resolved = false;

      const finish = (result: string | null) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(this.timeout);

      socket.on('data', (chunk) => {
        data += chunk.toString('utf-8');
      });

      socket.on('end', () => finish(data || null));
      socket.on('close', () => finish(data || null));
      socket.on('timeout', () => finish(null));
      socket.on('error', (err) => {
        this.log.debug('TCP error: %s', err.message);
        finish(null);
      });

      socket.connect(this.port, host, () => {
        setTimeout(() => {
          if (!resolved) {
            socket.write(cmd, 'utf-8');
          }
        }, this.connectDelay);
      });
    });
  }

  private async wakeAndResolveHost(): Promise<string | null> {
    if (this.host) {
      return this.host;
    }
    const device = await wakeAndDiscover();
    if (device) {
      this.host = device.ip;
      this.log.info('Discovered device at %s', device.ip);
      return device.ip;
    }
    return null;
  }

  private async executeCommand(cmd: string): Promise<string | null> {
    const host = await this.wakeAndResolveHost();
    if (!host) {
      this.log.warn('No device found via UDP discovery and no host configured');
      return null;
    }
    this.log.debug('TCP send → %s:%d: %s', host, this.port, cmd);
    const resp = await this.sendTcp(cmd, host);
    this.log.debug('TCP recv ← %s', resp ?? '(null)');
    return resp;
  }

  private enqueue(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.queue.push({ cmd, resolve });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;

    const item = this.queue.shift()!;
    try {
      const result = await this.executeCommand(item.cmd);
      item.resolve(result);
    } catch {
      item.resolve(null);
    } finally {
      this.busy = false;
      this.processQueue();
    }
  }

  async readStatus(): Promise<DeviceState | null> {
    const raw = await this.enqueue(buildStatusCommand());
    if (!raw) return null;

    const hexValues = parse2WLResponse(raw);
    if (!hexValues) return null;

    const state: DeviceState = {
      stato: 0,
      errore: 0,
      tempPrinc: 0,
      tempSec: 0,
      posPunto: 0,
      parameters: new Map(),
      sensors: new Map(),
      lastUpdate: new Date(),
    };

    for (const h of hexValues) {
      const parsed = parseHexDatapoint(h);

      if (parsed.type === 'main_values') {
        state.stato = parsed.stato;
        state.errore = parsed.errore;
        state.posPunto = parsed.posPunto;
        state.tempPrinc = applyPosPunto(parsed.tempPrinc, parsed.posPunto);
        state.tempSec = applyPosPunto(parsed.tempSec, parsed.posPunto);
      } else if (parsed.type === 'parameter' && !parsed.readOnly) {
        const pp = parsed.posPunto;
        const param: ParameterValue = {
          id: parsed.id,
          valore: parsed.valore,
          min: parsed.min,
          max: parsed.max,
          readOnly: parsed.readOnly,
          posPunto: pp,
          originalHex: h,
          value: applyPosPunto(parsed.valore, pp),
          minValue: applyPosPunto(parsed.min, pp),
          maxValue: applyPosPunto(parsed.max, pp),
        };
        state.parameters.set(parsed.id, param);
      } else if (parsed.type === 'sensor') {
        const sensor: SensorValue = {
          id: parsed.id,
          valore: parsed.valore,
          min: parsed.min,
          max: parsed.max,
        };
        state.sensors.set(parsed.id, sensor);
      }
    }

    return state;
  }

  async writeParameter(originalHex: string, newValue: number): Promise<boolean> {
    const cmd = build2WCCommand(originalHex, newValue);
    const resp = await this.enqueue(cmd);
    return resp !== null;
  }

  async turnOn(): Promise<boolean> {
    const resp = await this.enqueue(buildOnCommand());
    return resp !== null;
  }

  async turnOff(): Promise<boolean> {
    const resp = await this.enqueue(buildOffCommand());
    return resp !== null;
  }

  async resetError(): Promise<boolean> {
    const resp = await this.enqueue(buildResetCommand());
    if (resp && resp.includes('"OK"')) {
      return true;
    }
    return resp !== null;
  }
}
