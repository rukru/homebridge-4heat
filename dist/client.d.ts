/**
 * TCP client for 4HEAT PinKEY device.
 * Each request: UDP wake-up → TCP connect → 500ms delay → send → recv → close.
 * Serialized via promise queue — device cannot handle concurrent connections.
 */
import type { Logging } from 'homebridge';
import type { DeviceState } from './types.js';
import type { CronoSchedule } from './types.js';
export interface FourHeatClientOptions {
    timeout?: number;
    connectDelay?: number;
    debugTcp?: boolean;
}
export declare class FourHeatClient {
    private readonly log;
    private host;
    private readonly port;
    private busy;
    private queue;
    private readonly timeout;
    private readonly connectDelay;
    private readonly debugTcp;
    constructor(log: Logging, host: string | undefined, port: number, options?: FourHeatClientOptions);
    get currentHost(): string | undefined;
    private tcpLog;
    private sendTcp;
    private wakeAndResolveHost;
    private executeCommand;
    private enqueue;
    private processQueue;
    readStatus(): Promise<DeviceState | null>;
    writeParameter(originalHex: string, newValue: number): Promise<boolean>;
    turnOn(): Promise<boolean>;
    turnOff(): Promise<boolean>;
    resetError(): Promise<boolean>;
    readSchedule(): Promise<CronoSchedule | null>;
    writeSchedule(command: string): Promise<boolean>;
}
