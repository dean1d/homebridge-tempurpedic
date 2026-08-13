# homebridge-tempurpedic

<p align="center">
  <img src="https://raw.githubusercontent.com/dean1d/homebridge-tempurpedic/main/assets/logo.webp" alt="homebridge-tempurpedic logo" width="220" />
</p>

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm weekly downloads](https://img.shields.io/npm/dw/homebridge-tempurpedic)](https://www.npmjs.com/package/homebridge-tempurpedic)
[![npm total downloads](https://img.shields.io/npm/dt/homebridge-tempurpedic)](https://www.npmjs.com/package/homebridge-tempurpedic)

Homebridge platform plugin for Tempur-Pedic Smart Bases. Add one config entry per bed base and all 10 command switches appear in HomeKit automatically, controllable via Siri, the Home app, and Alexa via Matter.

For Matter controllers, command buttons are published as on/off plug-in units. This is the controllable-load device type recognized by Alexa; Matter's `OnOffSwitch` type represents a wall switch or other input controller and is not exposed by Alexa as a controllable button.

Commands are sent directly to the base over UDP — **no Java or external dependencies required**.

---

## Requirements

- [Homebridge](https://homebridge.io) v1.3.0 or later
- Your Tempur-Pedic Smart Base must be on the same local network as Homebridge
- A static IP assigned to your base (recommended, so the IP doesn't change)

---

## Installation

```bash
npm i homebridge-tempurpedic
```

Or search for **homebridge-tempurpedic** in the Homebridge UI plugin search.

---

## Configuration

Use the Homebridge UI to configure the plugin — no manual JSON editing required. Add one entry per bed base with its name, IP address, and optional delay. You can also rename or enable/disable individual switches per base.

### Manual config.json example

```json
{
  "platforms": [
    {
      "platform": "TempurPedic",
      "name": "TempurPedic",
      "bases": [
        {
          "name": "Bedroom Base",
          "ip": "192.168.4.158",
          "delay": 1000
        }
      ]
    }
  ]
}
```

### Split-king (two bases) example

```json
{
  "platforms": [
    {
      "platform": "TempurPedic",
      "name": "TempurPedic",
      "bases": [
        {
          "name": "Left Base",
          "ip": "192.168.4.158",
          "delay": 1000
        },
        {
          "name": "Right Base",
          "ip": "192.168.4.159",
          "delay": 1000
        }
      ]
    }
  ]
}
```

| Key       | Required | Default | Description |
|-----------|----------|---------|-------------|
| `platform` | ✅ | — | Must be `"TempurPedic"` |
| `name`    | ✅ | — | Name of the bed base shown in HomeKit |
| `ip`      | ✅ | — | IP address of the Smart Base on your LAN |
| `delay`   | ❌ | `1000` | ms before each switch auto-resets to Off |

---

## Switches created per base

For a base named `"Bedroom Base"`:

| HomeKit Switch            | UDP Command   |
|---------------------------|---------------|
| Bedroom Base Vibrate 1    | `0x33053203948D007861` |
| Bedroom Base Vibrate 2    | `0x33053203948D017860` |
| Bedroom Base Vibrate 3    | `0x33053203948D027863` |
| Bedroom Base Vibrate 4    | `0x33053203948D037862` |
| Bedroom Base Vibrate Stop | `0x3305320A9486000012` |
| Bedroom Base Position 1   | `0x3305320394 5C0000C8` |
| Bedroom Base Position 2   | `0x3305320394 5C0100C9` |
| Bedroom Base Position 3   | `0x3305320394 5C0200CA` |
| Bedroom Base Position 4   | `0x3305320394 5C0300CB` |
| Bedroom Base Bed Flat     | `0x3305320A945C0400CC` |

---

## How It Works

The plugin sends 9-byte binary UDP packets directly to the base on port `50007`. This is the same protocol used by the Tempur-Pedic mobile app and discovered through community reverse-engineering. No external tools, Java, or cloud services are required.

---

## Credits

The UDP protocol and hex command codes were discovered and documented by the community:

- [java-alexa-tempurpedic-skill](https://github.com/docwho2/java-alexa-tempurpedic-skill) by [@docwho2](https://github.com/docwho2)
- [HomeSeer Community](https://forums.homeseer.com/forum/homeseer-products-services/general-discussion-area/message-board-bugs-suggs/98404-tempurpedic-bed-control)

---

## Disclaimer

- I am in no way affiliated with Tempur-Pedic and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk.

---

## Support & Donations

This plugin is free and open source. If it saved you some time or frustration and you'd like to say thanks, any support is greatly appreciated!

<a href="https://buymeacoffee.com/dean1d" target="_blank">
  <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-dean1d-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee" />
</a>

<a href="https://cash.app/$dkoenigBOA" target="_blank">
  <img src="https://img.shields.io/badge/Cash%20App-%24dkoenigBOA-00C244?style=for-the-badge&logo=cash-app&logoColor=white" alt="Cash App" />
</a>

<a href="http://venmo.com/u/Dean1d" target="_blank">
  <img src="https://img.shields.io/badge/Venmo-Dean1d-3D95CE?style=for-the-badge&logo=venmo&logoColor=white" alt="Venmo" />
</a>

---

## License

MIT
