# Test Coverage Analysis

## Current State

**73 tests** across 3 test files, all passing. The test framework is Node.js built-in
`node:test` with `node:assert/strict`. No coverage reporting tool is configured.

### Files by test coverage

| Source File | Lines | Tested | Notes |
|---|---|---|---|
| `protocol.ts` | 255 | Yes (53 tests) | All exported functions tested with edge cases |
| `types.ts` | 256 | Partial (13 tests) | Sensor definitions and config filtering tested; types/constants are not logic |
| `udp.ts` | 97 | Partial (7 tests) | `parseCF4Response` tested; `wakeAndDiscover`/`attemptDiscovery` untested |
| `client.ts` | 234 | No | TCP client, queue, host resolution — all untested |
| `platform.ts` | 320 | No | Polling, backoff, crono, turnOn/turnOff — all untested |
| `stoveAccessory.ts` | 576 | No | State mapping, sensor math, schedule display, debounce — all untested |
| `settings.ts` | 16 | N/A | Constants only, no logic |
| `index.ts` | 8 | N/A | Plugin registration only, no logic |

**Estimated line coverage: ~30%** — protocol parsing is well-tested, but the three
largest modules (`client.ts`, `platform.ts`, `stoveAccessory.ts`) totalling ~1130 lines
have zero test coverage.

---

## Coverage Gaps and Recommendations

### 1. `client.ts` — `readStatus()` state assembly (high value)

`readStatus()` at `src/client.ts:140-197` orchestrates parsing a raw 2WL response into a
full `DeviceState`. It calls `parse2WLResponse`, then iterates hex values through
`parseHexDatapoint`, assembling `parameters`, `sensors`, `statoCrono`, and temperature
fields. While the individual parsing functions are tested, the composition logic is not.

**What to test:**
- Given a realistic multi-datapoint 2WL response string, verify `readStatus()` produces
  the correct `DeviceState` with properly populated `parameters`, `sensors`, `stato`,
  `tempPrinc` (with `applyPosPunto` applied), and `statoCrono`
- Verify that read-only parameters are excluded from `state.parameters` (line 168)
- Verify that `state_info` datapoints populate `statoCrono` (line 192)
- Verify null/empty responses return `null`

**How to test:** Inject a mock `enqueue` that returns a canned response string. The
`FourHeatClient` constructor takes a `Logging` object and host/port — provide stubs and
override the private `sendTcp`/`wakeAndResolveHost` methods, or extract `readStatus`
parsing into a standalone pure function.

**Recommended approach:** Extract the parsing portion (lines 144-196) into a pure
function like `parseDeviceState(raw: string): DeviceState | null` in `protocol.ts`.
This makes it directly testable without any mocking, and `readStatus()` becomes a thin
wrapper around `enqueue` + `parseDeviceState`.

---

### 2. `stoveAccessory.ts` — `calculateNextEvent()` (high value, pure logic)

The `calculateNextEvent()` method at `src/stoveAccessory.ts:536-573` determines the
next scheduled on/off event from a `CronoSchedule` and formats it for the switch name
(e.g., `"ON 07:30"`, `"OFF 22:00"`, `"Mon ON 07:30"`). It handles three schedule
periods (daily, weekly, weekend) and wraps around the week.

**What to test:**
- Daily schedule (`periodo=1`): same day schedule returned for all days
- Weekly schedule (`periodo=2`): correct day-specific schedule
- Weekend schedule (`periodo=3`): weekday vs weekend distinction (line 551)
- Current time before first slot → returns `"ON HH:MM"`
- Current time during a slot → returns `"OFF HH:MM"`
- Current time after all slots today → returns next day label like `"Tue ON 07:00"`
- No enabled slots → returns `null`
- Slots with `start === '00:00'` and `end === '00:00'` are filtered out (line 560)

**How to test:** This is private and date-dependent. Extract it as a standalone function
`calculateNextEvent(schedule: CronoSchedule, now: Date): string | null` in a utility
module or in `protocol.ts`. Then test with deterministic `Date` values.

---

### 3. `stoveAccessory.ts` — State mapping functions (high value, pure logic)

Three private methods determine how stove states map to HomeKit states:

- `mapCurrentState()` at line 323: maps stove `stato` to `HEAT` or `OFF`
- `isActiveState()` at line 331: returns `true` for any state except `OFF`/`EXTINGUISHING`
- `isInFaultState()` at line 335: returns `true` for `BLOCK` or `SAFETY_MODE`

**What to test:**
- Every `STATO` value (0-10) should be classified correctly
- `HEATING_STATES` set (line 9-17) should match states 1-6 and 10
- `OFF` (0) and `EXTINGUISHING` (7) are not active
- Only `BLOCK` (9) and `SAFETY_MODE` (8) are fault states

**How to test:** Extract these as pure functions accepting a `stato` number:
```typescript
export function mapCurrentState(stato: number): 'HEAT' | 'OFF';
export function isActiveState(stato: number): boolean;
export function isInFaultState(stato: number): boolean;
```

---

### 4. `stoveAccessory.ts` — Sensor value calculations (medium value)

`getSensorValue()` at `src/stoveAccessory.ts:186-211` computes sensor display values
with different logic per service type:

- **TemperatureSensor**: applies `applyPosPunto(raw, posPunto)` (line 196)
- **HumiditySensor**: normalizes to 0-100% based on min/max range (lines 199-203)
- **LightSensor**: clamps to minimum 0.0001 (line 207)

**What to test:**
- Temperature sensor: verify `applyPosPunto` is applied to raw value
- Humidity sensor: verify percentage calculation `((raw - min) / (max - min)) * 100`
- Humidity sensor: verify clamping to [0, 100] range
- Humidity sensor: verify `range <= 0` returns 0 (line 201)
- Light sensor: verify raw=0 returns 0.0001 minimum
- Missing sensor data returns 0 (or 0.0001 for light)

**How to test:** Extract as a pure function
`computeSensorValue(meta: SensorMeta, sensor: SensorValue, posPunto: number): number`.

---

### 5. `platform.ts` — Backoff logic (medium value)

`handlePollFailure()` at `src/platform.ts:183-192` implements exponential backoff with
steps `[5, 10, 30, 60]` (line 21). The backoff index is clamped to the array length.

**What to test:**
- First failure → 5s backoff
- Second failure → 10s backoff
- Third failure → 30s backoff
- Fourth+ failures → 60s (capped)
- `consecutiveFailures` resets to 0 on success (line 138)
- Connection restored log message after failures (lines 135-137)

**How to test:** The backoff calculation itself is a one-liner that could be extracted:
```typescript
export function getBackoffSeconds(failures: number): number {
  const BACKOFF_STEPS = [5, 10, 30, 60];
  return BACKOFF_STEPS[Math.min(failures - 1, BACKOFF_STEPS.length - 1)];
}
```

---

### 6. `stoveAccessory.ts` — Target override TTL (medium value)

The target override mechanism (lines 259-263, 346-352, 355-359) prevents UI flicker when
the user toggles the stove on/off. The override expires after 60 seconds or when the
device state catches up with the override value.

**What to test:**
- Override is set with 60s TTL on `setTargetHeatingState`
- Override is cleared when device state matches the override value (line 260)
- Override is cleared when TTL expires (line 260)
- `getTargetHeatingState` returns override value while active
- `getTargetHeatingState` returns device-derived state when override is expired

---

### 7. `platform.ts` — `turnOn()` with auto-reset (medium value)

`turnOn()` at `src/platform.ts:208-224` has special logic: if the stove is in `BLOCK`
state, it automatically resets the error before turning on.

**What to test:**
- Normal turn-on (not blocked): calls `client.turnOn()` and polls
- Blocked stove: calls `resetError()` first, then polls, then turns on
- Reset fails (stove still blocked): returns `false` without calling `turnOn()`
- Reset succeeds: calls `turnOn()` afterward

---

### 8. `platform.ts` — Crono enable/disable (lower value)

`enableCrono()` at line 262 and `disableCrono()` at line 290 have logic for handling
missing schedule data and preserving the original `periodo` value.

**What to test:**
- Enable with no cached schedule → triggers `refreshSchedule()` first
- Enable with `periodo=0` and saved `originalPeriodo` → uses saved periodo
- Enable with no periodo and no saved periodo → returns `false` with warning
- Disable sends `buildCCSDisableCommand` and refreshes

---

### 9. No coverage reporting tool (infrastructure)

There is no coverage tool configured. Adding `c8` (the recommended coverage tool for
Node.js built-in test runner) would provide actual line/branch/function coverage metrics.

**Recommendation:**
```bash
npm install --save-dev c8
```

Add a `coverage` script to `package.json`:
```json
{
  "scripts": {
    "coverage": "tsc -p test/tsconfig.json && c8 node --test dist-test/test/*.test.js"
  }
}
```

---

## Prioritized Action Plan

### Tier 1 — High value, low effort (extract pure functions and test)

1. **Extract `parseDeviceState()`** from `client.ts:readStatus()` into `protocol.ts`
   and test the full parsing pipeline with realistic device responses
2. **Extract `calculateNextEvent()`** from `stoveAccessory.ts` into a testable module
   and cover all schedule period types and time-of-day cases
3. **Extract state classification functions** (`mapCurrentState`, `isActiveState`,
   `isInFaultState`) and test every stove state value (0-10)

### Tier 2 — Medium value, medium effort (extract + test)

4. **Extract `computeSensorValue()`** and test the three calculation paths
   (temperature, humidity, light) including edge cases
5. **Extract backoff calculation** and test the progression [5, 10, 30, 60, 60...]
6. **Add `c8` for coverage reporting** to get actual metrics

### Tier 3 — Medium value, higher effort (requires mocking)

7. **Test target override TTL** — requires mocking `Date.now()`
8. **Test `turnOn()` auto-reset** — requires mocking `FourHeatClient`
9. **Test crono enable/disable** — requires mocking client and schedule state
10. **Test queue serialization** in `client.ts` — requires mocking TCP socket

The pattern across all recommendations is the same: **extract logic out of classes into
pure, exported functions**, then test those functions directly without needing Homebridge
mocks or network stubs. This improves both testability and code clarity.
