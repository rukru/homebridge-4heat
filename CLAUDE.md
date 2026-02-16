# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Homebridge plugin for the **4HEAT PinKEY in box** — a WiFi-to-RS485 adapter (by TiEmme Elettronica) connected to a pellet stove/boiler. Communicates over TCP using the `2ways` protocol (NOT `syevo`). Exposes stove controls to Apple Home via HomeKit (thermostat, sensors, schedule switch, smoke alert).

## Commands

```bash
rm -rf dist && ./node_modules/.bin/tsc    # build (rimraf may break, use this)
npm test                                   # run tests
```

## Architecture

TypeScript, ES modules, no external runtime dependencies.

- **`src/platform.ts`** — Platform plugin: discovery, polling loop, backoff, write commands
- **`src/stoveAccessory.ts`** — HomeKit accessory: thermostat, sensors, crono switch, alert sensor
- **`src/client.ts`** — TCP client for 4HEAT device (2ways + CCS/CCG protocols)
- **`src/protocol.ts`** — Hex parsing, command builders, data types
- **`src/types.ts`** — TypeScript types, constants (STATO, ERROR_CODES, SENSOR_DEFINITIONS)
- **`src/settings.ts`** — Plugin constants (PLUGIN_NAME, PLATFORM_NAME, defaults)
- **`from_apk/`** — Decompiled APK source (controllers.js, tcp-services.js, LastVersion.xml) — protocol reference, do NOT modify
- **`4heat_control.py`** — Legacy Python prototype, NOT a reference for protocol implementation

### Protocol

Original protocol reference: `from_apk/controllers.js` and `from_apk/LastVersion.xml`. Key points:

- TCP socket to device port 80, 500ms connect delay before sending
- Commands: `["2WL","0"]` (status), `["2WC","1","<hex>"]` (write), `["RST","1"]` (reset)
- ON/OFF: hex strings `05040000` / `05050000` sent as-is (NOT via hex2a)
- Parameters: `"05" + param_id_hex[0:6] + value_hex` sent as-is
- Graceful TCP close (FIN, not RST) — device crashes on RST flood

## Versioning

**IMPORTANT:** Bump version in `package.json` on every commit that changes plugin behavior (features, fixes, protocol changes). Use semver:
- patch (1.5.0 → 1.5.1): bug fixes, stability improvements
- minor (1.5.0 → 1.6.0): new features, new config options
- major: breaking changes to config schema

## Key Parameter IDs

| ID | Meaning | Range |
|----|---------|-------|
| `0x0180` | On/Off switch | 0–1 |
| `0x017e` | Temperature setpoint | 0–49 |
| `0x016c` | Max power level | 1–6 |
| `0x016b` | Min power level | 1–6 |
| `0x017d` | Operating mode | 0–11 |
| `0x00c7` | Max boiler temp | 30–75 |
