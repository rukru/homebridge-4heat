import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SENSOR_DEFINITIONS,
  SENSOR_EXHAUST_TEMP,
  SENSOR_ROOM_TEMP,
  SENSOR_BOILER_TEMP,
  SENSOR_WATER_PRESSURE,
  SENSOR_FLAME_LIGHT,
  SENSOR_DHW_TEMP,
  SENSOR_BUFFER_TEMP,
  SENSOR_FLOW_TEMP_1,
  SENSOR_EXTERNAL_TEMP,
  SENSOR_AIR_FLOW,
} from '../src/types.js';
import type { SensorsConfig } from '../src/types.js';

describe('SENSOR_DEFINITIONS', () => {
  it('has exactly 10 entries', () => {
    assert.equal(SENSOR_DEFINITIONS.length, 10);
  });

  it('has unique ids', () => {
    const ids = SENSOR_DEFINITIONS.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('has unique configKeys', () => {
    const keys = SENSOR_DEFINITIONS.map(s => s.configKey);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('has unique subtypes', () => {
    const subtypes = SENSOR_DEFINITIONS.map(s => s.subtype);
    assert.equal(new Set(subtypes).size, subtypes.length);
  });

  it('maps all known sensor constants', () => {
    const ids = new Set(SENSOR_DEFINITIONS.map(s => s.id));
    for (const expected of [
      SENSOR_EXHAUST_TEMP, SENSOR_ROOM_TEMP, SENSOR_BOILER_TEMP,
      SENSOR_WATER_PRESSURE, SENSOR_FLAME_LIGHT, SENSOR_DHW_TEMP,
      SENSOR_BUFFER_TEMP, SENSOR_FLOW_TEMP_1, SENSOR_EXTERNAL_TEMP,
      SENSOR_AIR_FLOW,
    ]) {
      assert.ok(ids.has(expected), `Missing sensor 0x${expected.toString(16)}`);
    }
  });

  it('temperature sensors use TemperatureSensor service', () => {
    const tempIds = new Set([
      SENSOR_EXHAUST_TEMP, SENSOR_ROOM_TEMP, SENSOR_BOILER_TEMP,
      SENSOR_DHW_TEMP, SENSOR_BUFFER_TEMP, SENSOR_FLOW_TEMP_1,
      SENSOR_EXTERNAL_TEMP,
    ]);
    for (const def of SENSOR_DEFINITIONS) {
      if (tempIds.has(def.id)) {
        assert.equal(def.serviceType, 'TemperatureSensor', `${def.displayName} should be TemperatureSensor`);
      }
    }
  });

  it('water pressure uses HumiditySensor', () => {
    const def = SENSOR_DEFINITIONS.find(s => s.id === SENSOR_WATER_PRESSURE);
    assert.ok(def);
    assert.equal(def.serviceType, 'HumiditySensor');
  });

  it('flame light and air flow use LightSensor', () => {
    for (const id of [SENSOR_FLAME_LIGHT, SENSOR_AIR_FLOW]) {
      const def = SENSOR_DEFINITIONS.find(s => s.id === id);
      assert.ok(def);
      assert.equal(def.serviceType, 'LightSensor', `Sensor 0x${id.toString(16)} should be LightSensor`);
    }
  });
});

describe('SensorsConfig filtering', () => {
  it('empty config enables no sensors', () => {
    const config: SensorsConfig = {};
    const enabled = SENSOR_DEFINITIONS.filter(s => config[s.configKey]);
    assert.equal(enabled.length, 0);
  });

  it('single sensor enabled', () => {
    const config: SensorsConfig = { roomTemp: true };
    const enabled = SENSOR_DEFINITIONS.filter(s => config[s.configKey]);
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].id, SENSOR_ROOM_TEMP);
  });

  it('multiple sensors enabled', () => {
    const config: SensorsConfig = { exhaustTemp: true, waterPressure: true, airFlow: true };
    const enabled = SENSOR_DEFINITIONS.filter(s => config[s.configKey]);
    assert.equal(enabled.length, 3);
    const ids = new Set(enabled.map(s => s.id));
    assert.ok(ids.has(SENSOR_EXHAUST_TEMP));
    assert.ok(ids.has(SENSOR_WATER_PRESSURE));
    assert.ok(ids.has(SENSOR_AIR_FLOW));
  });

  it('all sensors enabled', () => {
    const config: SensorsConfig = {
      exhaustTemp: true, roomTemp: true, boilerTemp: true,
      dhwTemp: true, bufferTemp: true, flowTemp: true,
      externalTemp: true, waterPressure: true, flameLight: true, airFlow: true,
    };
    const enabled = SENSOR_DEFINITIONS.filter(s => config[s.configKey]);
    assert.equal(enabled.length, 10);
  });

  it('false values are not enabled', () => {
    const config: SensorsConfig = { roomTemp: false, exhaustTemp: true };
    const enabled = SENSOR_DEFINITIONS.filter(s => config[s.configKey]);
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].configKey, 'exhaustTemp');
  });
});
