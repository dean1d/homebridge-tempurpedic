# Changelog

All notable changes to `homebridge-tempurpedic` will be documented in this file.

## [4.6.11] - 2026-08-08

### Added
- Added the Verified by Homebridge badge to the README

### Fixed
- Added a UDP socket error listener so socket-level errors are logged instead of thrown
- Removed the obsolete manual installer and its Java/JAR installation instructions

## [4.6.10] - 2026-08-04

### Fixed
- Declared both HAP and Matter transport support in the package metadata
- Updated `config.schema.json` to use standard object-level `required` arrays

## [4.6.5] - 2026-05-14

### Added
- Matter support for Homebridge v2.0+ — each switch is now exposed as an individual Matter `OnOffOutlet` device, making them available in Amazon Alexa, Google Home, and other Matter-compatible platforms
- Matter auto-reset — Matter accessories reset to Off after the configured delay, same as HAP switches
- Vibration button naming option — choose between "Vibrate", "Vibration", or "Both" from the Homebridge UI config
- Naming dropdown also applies to the stop switch (`Stop Vibrate` vs `Stop Vibration`)
- ON and OFF events now logged separately for both HAP and Matter switches including auto-reset confirmation
- HAP service references stored internally for cross-stack state sync between Matter and HomeKit

### Fixed
- Fixed duplicate log entries and duplicate UDP commands on button press — switched from `.onGet()`/`.onSet()` Homebridge wrappers to raw `.on('get')`/`.on('set')` handlers which correctly clear with `removeAllListeners`, preventing handler stacking on each restart
- Fixed HAP switch remaining "On" in HomeKit after being triggered via Matter — Matter `on` handler now also resets the corresponding HAP switch state after the delay
- Fixed Matter accessories not reliably auto-resetting to Off after the configured delay
- Fixed Matter device type showing as "Not Supported" in Apple Home — using `OnOffOutlet` for Apple Home compatibility
- Node.js v24 compatibility warning resolved — added `^24` to `engines.node`

### Changed
- Renamed "Vibrate Stop" to "Stop Vibration" / "Stop Vibrate" depending on vibration naming setting
- Checkboxes in UI always labelled "Vibrate 1–4" regardless of naming — label in HomeKit is controlled by the dropdown
- Homebridge v2.0 `engines` field updated to `^1.6.0 || ^2.0.0`

## [4.4.0] - 2026-05-05

### Added
- Per-base switch enable/disable toggles in the Homebridge UI — uncheck any switch to prevent it from being created in HomeKit
- `enableVibrate1-4`, `enableVibrateStop`, `enablePosition1-4`, `enableFlat` config options per base

### Fixed
- Switches section now renders correctly per bed base in the Homebridge UI (previously appeared globally above all bases)

## [4.3.0] - 2026-05-05

### Changed
- Plugin is now fully self-contained — removed dependency on the external `AlexaTempurpedic-1.0.jar` file
- Commands are now sent directly via UDP on port `50007` using Node.js built-in `dgram` module
- Java is no longer required on the host machine
- Firmware version now reads dynamically from `package.json` so it always matches the published version

### Removed
- `bin/AlexaTempurpedic-1.0.jar` — no longer bundled or required
- `jarPath` config option — no longer needed

## [4.2.0] - 2026-05-05

### Added
- Homebridge config UI schema (`config.schema.json`) — no more manual JSON editing
- Configure bed base name, IP address, and delay directly from the Homebridge UI
- Support for multiple bed bases (e.g. split-king) from a single platform config entry
- `ADD BED BASE` button in UI for adding additional bases

### Changed
- Migrated from individual `accessory` entries to a `platform` plugin — one config block creates all switches automatically
- Config moves from `accessories[]` to `platforms[]`

## [4.1.0] - 2026-05-05

### Added
- Initial public release
- Support for 10 switches per base: Vibrate 1–4, Stop Vibration, Position 1–4, Flat
- Switches auto-reset to Off after configurable delay (default 1000ms)
- Single platform config entry creates all switches — no need to define each switch individually
- Named switches appear correctly under one device tile in HomeKit
- `config.schema.json` for Homebridge UI integration
- Funding links: Buy Me a Coffee, Cash App, Venmo
