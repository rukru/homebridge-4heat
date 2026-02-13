# homebridge-4heat

Homebridge plugin for **4HEAT PinKEY in box** — a WiFi-to-RS485 adapter by TiEmme Elettronica for pellet stoves/boilers. Communicates over TCP using the `2ways` protocol.

## Features

- **Thermostat** — set target boiler temperature (30–75°C), turn on/off
- **Auto error reset** — if the stove is blocked, automatically resets the error before turning on
- **Error display** — shows error code and description in the thermostat name during fault state
- **Room temperature** — linked TemperatureSensor (appears automatically if sensor data is available)
- **Auto-discovery** — finds the device via UDP broadcast (requires host network; in Docker use manual IP)
- **Resilient polling** — exponential backoff on connection failures

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
      "maxTemp": 75
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

## Protocol

Uses the 4HEAT `2ways` protocol over TCP port 80:
- `["2WL","0"]` — read all sensors and parameters
- `["2WC","1","<payload>"]` — write command (on/off, parameter change)
- `["RST","0"]` — reset error
- `["CF4","0"]` — UDP broadcast discovery (port 6666/5555)

## Development

```bash
pnpm install
pnpm run build
pnpm test
```

## License

ISC
