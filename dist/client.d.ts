/**
 * TCP client for 4HEAT PinKEY device.
 * Each request: UDP wake-up → TCP connect → 500ms delay → send → recv → close.
 * Serialized via promise queue — device cannot handle concurrent connections.
 */
import type { Logging } from 'homebridge';
import type { DeviceState } from './types.js';
export declare class FourHeatClient {
    private readonly log;
    private host;
    private readonly port;
    private readonly timeout;
    private readonly connectDelay;
    private busy;
    private queue;
    constructor(log: Logging, host: string | undefined, port: number, timeout?: number, connectDelay?: number);
    get currentHost(): string | undefined;
    private sendTcp;
    private wakeAndResolveHost;
    private executeCommand;
    private enqueue;
    private processQueue;
    readStatus(): Promise<DeviceState | null>;
    writeParameter(originalHex: string, newValue: number): Promise<boolean>;
    resetError(): Promise<boolean>;
}
