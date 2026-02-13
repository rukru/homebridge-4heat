/**
 * 4HEAT 2ways protocol: hex parsing and command building.
 * Ported from 4heat_control.py
 */
export function signed16(val) {
    return val > 32767 ? val - 65536 : val;
}
export function applyPosPunto(raw, posPunto) {
    const div = posPunto > 0 ? 10 ** posPunto : 1;
    return raw / div;
}
export function parse2WLResponse(raw) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('["2WL"')) {
        return null;
    }
    const inner = trimmed.slice(1, -1); // remove [ ]
    const parts = inner.split('","');
    parts[0] = parts[0].replace(/^"/, '');
    parts[parts.length - 1] = parts[parts.length - 1].replace(/"$/, '');
    // parts[0]="2WL", parts[1]=count, parts[2:]=hex values
    return parts.slice(2);
}
export function parseHexDatapoint(h) {
    if (!h || h.length < 4) {
        return { type: 'unknown', raw: h };
    }
    const t = parseInt(h.slice(0, 2), 16);
    try {
        if (t === 0x10) {
            return {
                type: 'main_values',
                tempSec: signed16(parseInt(h.slice(6, 10), 16)),
                stato: parseInt(h.slice(10, 12), 16),
                errore: parseInt(h.slice(12, 14), 16),
                tempPrinc: signed16(parseInt(h.slice(20, 24), 16)),
                posPunto: h.length > 36 ? parseInt(h.slice(36, 38), 16) : 0,
            };
        }
        if (t === 0x0c) {
            const sub = h.slice(2, 4);
            if (sub === '81') {
                const result = {
                    type: 'state_info',
                    statoCrono: parseInt(h.slice(4, 6), 16),
                    potenza: String.fromCharCode(parseInt(h.slice(6, 8), 16)),
                    lingua: parseInt(h.slice(8, 10), 16),
                    ricetta: parseInt(h.slice(10, 12), 16),
                    rs485Addr: parseInt(h.slice(12, 14), 16),
                };
                if (h.length >= 28) {
                    result.termostato = parseInt(h.slice(24, 28), 16);
                }
                if (h.length >= 30) {
                    result.posPunto = parseInt(h.slice(28, 30), 16);
                }
                return result;
            }
            if (sub === '00' || sub === '01' || sub === '80') {
                let text = '';
                for (let i = 4; i < h.length; i += 2) {
                    text += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
                }
                return { type: 'state_text', id: parseInt(sub, 16), text };
            }
            return { type: 'unknown', raw: h };
        }
        if (t === 0x0e) {
            return {
                type: 'parameter',
                id: parseInt(h.slice(2, 6), 16),
                valore: signed16(parseInt(h.slice(6, 10), 16)),
                min: signed16(parseInt(h.slice(10, 14), 16)),
                max: signed16(parseInt(h.slice(14, 18), 16)),
                readOnly: parseInt(h.slice(18, 20), 16) !== 0,
                posPunto: h.length > 20 ? parseInt(h.slice(20, 22), 16) : 0,
            };
        }
        if (t === 0x12) {
            return {
                type: 'sensor',
                id: parseInt(h.slice(2, 6), 16),
                valore: signed16(parseInt(h.slice(6, 10), 16)),
                min: signed16(parseInt(h.slice(10, 14), 16)),
                max: signed16(parseInt(h.slice(14, 18), 16)),
                readOnly: parseInt(h.slice(18, 20), 16) !== 0,
            };
        }
        if (t === 0x01) {
            return {
                type: 'thermostat',
                id: parseInt(h.slice(2, 4), 16),
                abilitazione: parseInt(h.slice(6, 8), 16),
                status: parseInt(h.slice(8, 10), 16),
                valore: parseInt(h.slice(10, 12), 16),
                min: parseInt(h.slice(12, 14), 16),
                max: parseInt(h.slice(14, 16), 16),
                temperatura: parseInt(h.slice(18, 20), 16),
            };
        }
        if (t === 0x22) {
            return {
                type: 'thermostat_v2',
                id: parseInt(h.slice(2, 4), 16),
                valore: signed16(parseInt(h.slice(10, 14), 16)),
                min: signed16(parseInt(h.slice(14, 18), 16)),
                max: signed16(parseInt(h.slice(18, 22), 16)),
                temperatura: signed16(parseInt(h.slice(26, 30), 16)),
                posPunto: h.length > 30 ? parseInt(h.slice(30, 32), 16) : 0,
            };
        }
        if (t === 0x06) {
            return {
                type: 'power',
                id: parseInt(h.slice(2, 4), 16),
                valore: parseInt(h.slice(4, 6), 16),
                min: parseInt(h.slice(6, 8), 16),
                max: parseInt(h.slice(8, 10), 16),
            };
        }
        if (t === 0x08) {
            return {
                type: 'crono_enb',
                id: parseInt(h.slice(2, 4), 16),
                stato: parseInt(h.slice(4, 6), 16),
                modalita: parseInt(h.slice(6, 8), 16),
            };
        }
        return { type: 'unknown', raw: h };
    }
    catch {
        return { type: 'unknown', raw: h };
    }
}
export function build2WCCommand(originalHex, newValue) {
    const valHex = newValue < 0
        ? (newValue + 65536).toString(16).padStart(4, '0')
        : newValue.toString(16).padStart(4, '0');
    const cmdHex = '05' + originalHex.slice(0, 6) + valHex;
    return `["2WC","1","${cmdHex}"]`;
}
export function buildDirectCommand(hexPayload) {
    return `["2WC","1","${hexPayload}"]`;
}
export function buildOnCommand() {
    return buildDirectCommand('05040000');
}
export function buildOffCommand() {
    return buildDirectCommand('05050000');
}
export function buildResetCommand() {
    return '["RST","0"]';
}
export function buildStatusCommand() {
    return '["2WL","0"]';
}
// --- Crono (schedule) protocol ---
export function buildCCGCommand() {
    return '["CCG","0"]';
}
export function parseCCGResponse(raw) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('["CCG"'))
        return null;
    const inner = trimmed.slice(1, -1);
    const parts = inner.split('","');
    parts[0] = parts[0].replace(/^"/, '');
    parts[parts.length - 1] = parts[parts.length - 1].replace(/"$/, '');
    // parts: ["CCG", "71", "<periodo>", "1", "HH:MM", "HH:MM", "0|1", ...]
    // Minimum: 3 header + 7 days × 10 fields = 73
    if (parts.length < 73)
        return null;
    const periodo = parseInt(parts[2], 10);
    const days = [];
    let ptr = 3;
    for (let d = 0; d < 7; d++) {
        const dayNumber = parseInt(parts[ptr], 10);
        ptr++;
        const slots = [];
        for (let s = 0; s < 3; s++) {
            slots.push({
                start: parts[ptr].substring(0, 5),
                end: parts[ptr + 1].substring(0, 5),
                enabled: parts[ptr + 2].substring(0, 1) === '1',
            });
            ptr += 3;
        }
        days.push({ dayNumber, slots });
    }
    return { periodo, days, rawResponse: trimmed };
}
export function buildCCSFromSchedule(schedule, newPeriodo) {
    const periodo = newPeriodo ?? schedule.periodo;
    let contatore = 1;
    let body = '';
    for (const day of schedule.days) {
        body += `,"${day.dayNumber}"`;
        for (const slot of day.slots) {
            body += `,"${slot.start}","${slot.end}","${slot.enabled ? 1 : 0}"`;
        }
        contatore += 10;
    }
    return `["CCS","${contatore}","${periodo}"${body}]`;
}
export function buildCCSDisableCommand(schedule) {
    return buildCCSFromSchedule(schedule, 0);
}
export function buildCCSEnableCommand(schedule) {
    return buildCCSFromSchedule(schedule);
}
//# sourceMappingURL=protocol.js.map