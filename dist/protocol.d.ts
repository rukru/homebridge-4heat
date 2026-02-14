/**
 * 4HEAT 2ways protocol: hex parsing and command building.
 * Ported from 4heat_control.py
 */
import type { CronoSchedule } from './types.js';
/**
 * Parse a JSON-like string array from the 4HEAT protocol, e.g. '["2WL","3","AA"]' → ["2WL","3","AA"].
 * Returns null if the string does not start with the expected prefix.
 */
export declare function parseProtocolArray(raw: string, expectedPrefix: string): string[] | null;
export type ParsedDatapoint = {
    type: 'main_values';
    tempSec: number;
    stato: number;
    errore: number;
    tempPrinc: number;
    posPunto: number;
} | {
    type: 'state_info';
    statoCrono: number;
    potenza: string;
    lingua: number;
    ricetta: number;
    rs485Addr: number;
    termostato?: number;
    posPunto?: number;
} | {
    type: 'state_text';
    id: number;
    text: string;
} | {
    type: 'crono_enb';
    id: number;
    stato: number;
    modalita: number;
} | {
    type: 'parameter';
    id: number;
    valore: number;
    min: number;
    max: number;
    readOnly: boolean;
    posPunto: number;
} | {
    type: 'sensor';
    id: number;
    valore: number;
    min: number;
    max: number;
    readOnly: boolean;
} | {
    type: 'thermostat';
    id: number;
    abilitazione: number;
    status: number;
    valore: number;
    min: number;
    max: number;
    temperatura: number;
} | {
    type: 'thermostat_v2';
    id: number;
    valore: number;
    min: number;
    max: number;
    temperatura: number;
    posPunto: number;
} | {
    type: 'power';
    id: number;
    valore: number;
    min: number;
    max: number;
} | {
    type: 'unknown';
    raw: string;
};
export declare function signed16(val: number): number;
export declare function applyPosPunto(raw: number, posPunto: number): number;
export declare function parse2WLResponse(raw: string): string[] | null;
export declare function parseHexDatapoint(h: string): ParsedDatapoint;
export declare function build2WCCommand(originalHex: string, newValue: number): string;
export declare function buildDirectCommand(hexPayload: string): string;
export declare function buildOnCommand(): string;
export declare function buildOffCommand(): string;
export declare function buildResetCommand(): string;
export declare function buildStatusCommand(): string;
export declare function buildCCGCommand(): string;
export declare function parseCCGResponse(raw: string): CronoSchedule | null;
export declare function buildCCSFromSchedule(schedule: CronoSchedule, newPeriodo?: number): string;
export declare function buildCCSDisableCommand(schedule: CronoSchedule): string;
export declare function buildCCSEnableCommand(schedule: CronoSchedule): string;
