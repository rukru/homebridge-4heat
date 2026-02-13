# homebridge-4heat

Homebridge plugin for **4HEAT PinKEY in box** — a WiFi-to-RS485 adapter by TiEmme Elettronica for pellet stoves/boilers. Communicates over TCP using the `2ways` protocol.

## Features

- **Thermostat** — set target boiler temperature, turn on/off from Apple Home
- **Schedule switch (Crono)** — enable/disable the stove's built-in timer schedule from Apple Home, with next-event display
- **Configurable sensors** — enable any of 10 device sensors (temperature, pressure, flame, air flow) via Homebridge UI
- **On/Off debounce** — optional delay before executing on/off commands to prevent accidental taps
- **Auto error reset** — if the stove is blocked, automatically resets the error before turning on
- **Error display** — shows error code and description in the thermostat name during fault state
- **Auto-discovery** — finds the device via UDP broadcast (requires host network; in Docker use manual IP)
- **Resilient polling** — exponential backoff on connection failures
- **Configurable log level** — normal (events only), verbose (every poll), debug (+ TCP traffic)

## Install

Via Homebridge UI or terminal:

```bash
npm install https://github.com/rukru/homebridge-4heat
```

## Configuration

Minimal config (auto-discovery):

```json
{
  "platforms": [
    {
      "platform": "FourHeat4Way",
      "name": "4HEAT Stove"
    }
  ]
}
```

Full config:

```json
{
  "platforms": [
    {
      "platform": "FourHeat4Way",
      "name": "4HEAT Stove",
      "host": "192.168.1.9",
      "port": 80,
      "pollingInterval": 30,
      "minTemp": 30,
      "maxTemp": 75,
      "switchDebounce": 5,
      "cronoSwitch": true,
      "logLevel": "normal",
      "sensors": {
        "exhaustTemp": true,
        "roomTemp": true,
        "boilerTemp": false,
        "waterPressure": false
      }
    }
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `host` | *(auto-discovery)* | Device IP address |
| `port` | `80` | TCP port |
| `pollingInterval` | `30` | Polling interval in seconds |
| `minTemp` | `30` | Min target temperature (°C) |
| `maxTemp` | `75` | Max target temperature (°C) |
| `switchDebounce` | `0` | On/off delay in seconds (0 = disabled) |
| `cronoSwitch` | `false` | Show schedule on/off switch in HomeKit |
| `logLevel` | `normal` | `normal`, `verbose`, or `debug` |
| `sensors` | *(all off)* | Object with boolean toggles per sensor |

### Schedule Switch (Crono)

When `cronoSwitch` is enabled, a Switch service appears in Apple Home:

- **ON/OFF** reflects the stove's built-in timer schedule state (daily, weekly, or weekday/weekend modes)
- **Toggle OFF** sends a CCS command with `periodo=0` to disable the schedule on the device
- **Toggle ON** re-sends the last known schedule with its original periodo to re-enable it
- **Switch name** updates to show the next scheduled event: `Crono: ON 07:30`, `Crono: OFF 22:00`, or `Crono: Mon ON 07:30`
- The schedule itself must be configured using the **4HEAT app** — HomeKit only controls on/off

The plugin reads the schedule from the device via CCG command every ~5 minutes and after each toggle.

### Sensors

Enable sensors in Homebridge UI (Settings → Sensors) or in JSON config:

| Key | Sensor | HomeKit Service |
|-----|--------|----------------|
| `exhaustTemp` | Exhaust Temperature (0xFFFF) | TemperatureSensor |
| `roomTemp` | Room Temperature (0xFFF7) | TemperatureSensor |
| `boilerTemp` | Boiler Temperature (0xFFFC) | TemperatureSensor |
| `dhwTemp` | DHW Temperature (0xFFE2) | TemperatureSensor |
| `bufferTemp` | Buffer Temperature (0xFFFA) | TemperatureSensor |
| `flowTemp` | Flow Temperature (0xFFE4) | TemperatureSensor |
| `externalTemp` | External Temperature (0xFFF6) | TemperatureSensor |
| `waterPressure` | Water Pressure (0xFFFB) | HumiditySensor (0-100%) |
| `flameLight` | Flame Light (0xFFFD) | LightSensor |
| `airFlow` | Air Flow (0xFFED) | LightSensor |

## Protocol

Uses the 4HEAT `2ways` protocol over TCP port 80:
- `["2WL","0"]` — read all sensors and parameters
- `["2WC","1","<payload>"]` — write command (on/off, parameter change)
- `["RST","0"]` — reset error
- `["CCG","0"]` — read crono schedule from device
- `["CCS","71","<periodo>",...]` — write crono schedule (0=off, 1=daily, 2=weekly, 3=weekend)
- `["CF4","0"]` — UDP broadcast discovery (port 6666/5555)

## Development

```bash
npm install
npm run build
npm test
```

## License

ISC
