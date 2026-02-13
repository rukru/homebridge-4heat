import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  signed16,
  applyPosPunto,
  parse2WLResponse,
  parseHexDatapoint,
  build2WCCommand,
  buildDirectCommand,
  buildOnCommand,
  buildOffCommand,
  buildResetCommand,
  buildStatusCommand,
} from '../src/protocol.js';

describe('signed16', () => {
  it('positive value stays positive', () => {
    assert.equal(signed16(100), 100);
  });

  it('zero stays zero', () => {
    assert.equal(signed16(0), 0);
  });

  it('32767 stays positive', () => {
    assert.equal(signed16(32767), 32767);
  });

  it('32768 becomes -32768', () => {
    assert.equal(signed16(32768), -32768);
  });

  it('65535 becomes -1', () => {
    assert.equal(signed16(65535), -1);
  });

  it('65000 becomes negative', () => {
    assert.equal(signed16(65000), 65000 - 65536);
  });
});

describe('applyPosPunto', () => {
  it('posPunto=0 returns raw value', () => {
    assert.equal(applyPosPunto(250, 0), 250);
  });

  it('posPunto=1 divides by 10', () => {
    assert.equal(applyPosPunto(250, 1), 25.0);
  });

  it('posPunto=2 divides by 100', () => {
    assert.equal(applyPosPunto(1234, 2), 12.34);
  });

  it('negative posPunto treated as 0', () => {
    // posPunto > 0 check in code means negative falls through to div=1
    assert.equal(applyPosPunto(100, -1), 100);
  });
});

describe('parse2WLResponse', () => {
  it('parses valid 2WL response', () => {
    const raw = '["2WL","3","AA","BB","CC"]';
    const result = parse2WLResponse(raw);
    assert.deepEqual(result, ['AA', 'BB', 'CC']);
  });

  it('returns null for non-2WL response', () => {
    assert.equal(parse2WLResponse('["RST","OK"]'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parse2WLResponse(''), null);
  });

  it('handles whitespace around response', () => {
    const raw = '  ["2WL","2","DEAD","BEEF"]  ';
    const result = parse2WLResponse(raw);
    assert.deepEqual(result, ['DEAD', 'BEEF']);
  });

  it('parses single hex value', () => {
    const raw = '["2WL","1","1000000005000000000000140000000000000001"]';
    const result = parse2WLResponse(raw);
    assert.ok(result);
    assert.equal(result.length, 1);
  });
});

describe('parseHexDatapoint', () => {
  it('returns unknown for empty string', () => {
    const result = parseHexDatapoint('');
    assert.equal(result.type, 'unknown');
  });

  it('returns unknown for short string', () => {
    const result = parseHexDatapoint('AB');
    assert.equal(result.type, 'unknown');
  });

  describe('type 0x10 — main_values', () => {
    // Layout: h[0:2]=type, h[6:10]=tempSec, h[10:12]=stato, h[12:14]=errore,
    //         h[20:24]=tempPrinc, h[36:38]=posPunto
    it('parses main values', () => {
      // pos:  0  2  4  6    10 12 14       20       24          36
      //      10 00 00 00C8  05 00 000000   0118     000000000000 01
      const hex = '100000' + '00C8' + '05' + '00' + '000000' + '0118' + '000000000000' + '01';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'main_values');
      if (result.type === 'main_values') {
        assert.equal(result.tempSec, 200);
        assert.equal(result.stato, 5);
        assert.equal(result.errore, 0);
        assert.equal(result.tempPrinc, 280);
        assert.equal(result.posPunto, 1);
      }
    });

    it('handles negative temperature via signed16', () => {
      // tempPrinc at h[20:24] = FFEC → signed16 → -20
      const hex = '100000' + '0000' + '00' + '00' + '000000' + 'FFEC' + '000000000000' + '00';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'main_values');
      if (result.type === 'main_values') {
        assert.equal(result.tempPrinc, -20);
      }
    });

    it('parses stato=9 (BLOCK) and errore=12 (0x0C)', () => {
      // stato at h[10:12]=09, errore at h[12:14]=0C
      const hex = '100000' + '0000' + '09' + '0C' + '000000' + '0000' + '000000000000' + '00';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'main_values');
      if (result.type === 'main_values') {
        assert.equal(result.stato, 9);
        assert.equal(result.errore, 12);
      }
    });
  });

  describe('type 0x0e — parameter', () => {
    it('parses writable parameter', () => {
      // t=0e, id=00C7, valore=002D(45), min=001E(30), max=004B(75), readOnly=00, posPunto=00
      const hex = '0E00C7002D001E004B0000';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'parameter');
      if (result.type === 'parameter') {
        assert.equal(result.id, 0x00C7);
        assert.equal(result.valore, 45);
        assert.equal(result.min, 30);
        assert.equal(result.max, 75);
        assert.equal(result.readOnly, false);
        assert.equal(result.posPunto, 0);
      }
    });

    it('parses read-only parameter', () => {
      const hex = '0E018000010000000101';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'parameter');
      if (result.type === 'parameter') {
        assert.equal(result.id, 0x0180);
        assert.equal(result.valore, 1);
        assert.equal(result.readOnly, true);
      }
    });

    it('parses parameter with posPunto', () => {
      const hex = '0E00C700FA001E02EE0001';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'parameter');
      if (result.type === 'parameter') {
        assert.equal(result.posPunto, 1);
        assert.equal(result.valore, 250); // raw, before applyPosPunto
      }
    });
  });

  describe('type 0x12 — sensor', () => {
    it('parses sensor', () => {
      // t=12, id=FFF7, valore=00D2(210), min=0000, max=03E8(1000), readOnly=01
      const hex = '12FFF700D2000003E801';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'sensor');
      if (result.type === 'sensor') {
        assert.equal(result.id, 0xFFF7);
        assert.equal(result.valore, 210);
        assert.equal(result.min, 0);
        assert.equal(result.max, 1000);
      }
    });
  });

  describe('type 0x01 — thermostat', () => {
    // Layout: h[0:2]=type, h[2:4]=id, h[6:8]=abilitazione, h[8:10]=status,
    //         h[10:12]=valore, h[12:14]=min, h[14:16]=max, h[18:20]=temperatura
    it('parses thermostat', () => {
      // pos: 0  2  4  6  8  10 12 14 16 18
      //      01 02 00 01 01 19 0A 1E 00 16
      const hex = '01' + '02' + '00' + '01' + '01' + '19' + '0A' + '1E' + '00' + '16';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'thermostat');
      if (result.type === 'thermostat') {
        assert.equal(result.id, 2);
        assert.equal(result.abilitazione, 1);
        assert.equal(result.status, 1);
        assert.equal(result.valore, 0x19); // 25
        assert.equal(result.min, 0x0A);    // 10
        assert.equal(result.max, 0x1E);    // 30
        assert.equal(result.temperatura, 0x16); // 22
      }
    });
  });

  describe('type 0x06 — power', () => {
    it('parses power level', () => {
      // t=06, id=01, valore=03, min=01, max=06
      const hex = '0601030106';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'power');
      if (result.type === 'power') {
        assert.equal(result.id, 1);
        assert.equal(result.valore, 3);
        assert.equal(result.min, 1);
        assert.equal(result.max, 6);
      }
    });
  });

  describe('type 0x0c — state_info / state_text', () => {
    it('parses state_info (sub=81)', () => {
      // t=0c, sub=81, statoCrono=02, potenza=33('3'), lingua=00, ricetta=01, rs485Addr=05
      const hex = '0C810233000105';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'state_info');
      if (result.type === 'state_info') {
        assert.equal(result.statoCrono, 2);
        assert.equal(result.potenza, '3');
        assert.equal(result.ricetta, 1);
        assert.equal(result.rs485Addr, 5);
      }
    });

    it('parses state_text (sub=00)', () => {
      // t=0c, sub=00, text=4F4B ("OK")
      const hex = '0C004F4B';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'state_text');
      if (result.type === 'state_text') {
        assert.equal(result.text, 'OK');
      }
    });
  });

  describe('type 0x22 — thermostat_v2', () => {
    it('parses thermostat_v2', () => {
      // t=22, id=01, pad=00000000, valore=00C8(200), min=0064(100), max=01F4(500), pad=0000, temperatura=00D2(210), posPunto=01
      const hex = '220100000000C8006401F4000000D201';
      const result = parseHexDatapoint(hex);
      assert.equal(result.type, 'thermostat_v2');
      if (result.type === 'thermostat_v2') {
        assert.equal(result.id, 1);
        assert.equal(result.valore, 200);
        assert.equal(result.min, 100);
        assert.equal(result.max, 500);
        assert.equal(result.temperatura, 210);
        assert.equal(result.posPunto, 1);
      }
    });
  });
});

describe('command builders', () => {
  it('buildStatusCommand returns 2WL read', () => {
    assert.equal(buildStatusCommand(), '["2WL","0"]');
  });

  it('buildResetCommand returns RST', () => {
    assert.equal(buildResetCommand(), '["RST","0"]');
  });

  it('buildOnCommand returns 2WC with 05040000', () => {
    assert.equal(buildOnCommand(), '["2WC","1","05040000"]');
  });

  it('buildOffCommand returns 2WC with 05050000', () => {
    assert.equal(buildOffCommand(), '["2WC","1","05050000"]');
  });

  it('buildDirectCommand wraps hex payload', () => {
    assert.equal(buildDirectCommand('AABBCCDD'), '["2WC","1","AABBCCDD"]');
  });

  describe('build2WCCommand', () => {
    it('builds command from originalHex and value', () => {
      // originalHex = "0E00C7002D001E004B0000", take first 6 chars: "0E00C7"
      // newValue = 50 = 0x0032
      // result: "05" + "0E00C7" + "0032" = "050E00C70032"
      const result = build2WCCommand('0E00C7002D001E004B0000', 50);
      assert.equal(result, '["2WC","1","050E00C70032"]');
    });

    it('handles negative value via two\'s complement', () => {
      // newValue = -5 → -5 + 65536 = 65531 = 0xFFFB
      const result = build2WCCommand('0E00C7002D001E004B0000', -5);
      assert.equal(result, '["2WC","1","050E00C7fffb"]');
    });

    it('pads small values to 4 hex chars', () => {
      const result = build2WCCommand('0E00C7002D001E004B0000', 1);
      assert.equal(result, '["2WC","1","050E00C70001"]');
    });

    it('handles zero value', () => {
      const result = build2WCCommand('0E0180000100000001', 0);
      assert.equal(result, '["2WC","1","050E01800000"]');
    });
  });
});
