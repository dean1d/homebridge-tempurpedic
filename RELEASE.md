## What's Changed in v4.6.4

### 🐛 Bug Fixes

- **Fixed duplicate commands** — switching a button was sending the same UDP command multiple times (up to 6x) due to `onSet` handlers stacking up on every Homebridge restart. Handlers are now cleared before re-registration so only one fires per trigger.
- **Fixed Matter auto-reset** — Matter accessories were not reliably turning back off after the configured delay. The state update is now properly awaited.
- **Fixed "Not Supported" in Apple Home** — Matter accessories were using `GenericSwitch` which Apple Home does not yet support. Switched to `OnOffOutlet` which works correctly.

### ✨ Improvements

- **Better logging** — ON and OFF events are now logged separately for both HomeKit and Matter switches, including a confirmation message when a switch auto-resets:
  ```
  [TempurPedic] Master Bed → Vibrate 1 ON
  [TempurPedic] Master Bed → Vibrate 1 OFF (auto-reset)
  ```
- **Vibration naming applies to stop switch** — the "Vibrate / Vibration / Both" dropdown in settings now also controls whether the stop switch appears as "Stop Vibrate" or "Stop Vibration"

### 📦 Full Changelog
See [CHANGELOG.md](CHANGELOG.md) for the complete version history.

### 💛 Support
If this plugin is useful to you, consider buying me a coffee!

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-dean1d-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/dean1d)
[![Cash App](https://img.shields.io/badge/Cash%20App-%24dkoenigBOA-00C244?style=for-the-badge&logo=cash-app&logoColor=white)](https://cash.app/$dkoenigBOA)
[![Venmo](https://img.shields.io/badge/Venmo-Dean1d-3D95CE?style=for-the-badge&logo=venmo&logoColor=white)](http://venmo.com/u/Dean1d)
