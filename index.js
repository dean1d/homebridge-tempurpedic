'use strict';

const dgram = require('dgram');

const PLUGIN_NAME   = 'homebridge-tempurpedic';
const PLATFORM_NAME = 'TempurPedic';
const UDP_PORT      = 50007;

// All commands are 9-byte binary payloads sent via UDP to port 50007.
// Hex strings sourced from community reverse-engineering of the Tempur-Pedic
// Ergo Premier Wi-Fi module.
const COMMANDS = {
  vibrate1:    Buffer.from('3305320394 8D 00 78 61'.replace(/\s/g, ''), 'hex'),
  vibrate2:    Buffer.from('3305320394 8D 01 78 60'.replace(/\s/g, ''), 'hex'),
  vibrate3:    Buffer.from('3305320394 8D 02 78 63'.replace(/\s/g, ''), 'hex'),
  vibrate4:    Buffer.from('3305320394 8D 03 78 62'.replace(/\s/g, ''), 'hex'),
  vibrateStop: Buffer.from('3305320A94 86 00 00 12'.replace(/\s/g, ''), 'hex'),
  position1:   Buffer.from('3305320394 5C 00 00 C8'.replace(/\s/g, ''), 'hex'),
  position2:   Buffer.from('3305320394 5C 01 00 C9'.replace(/\s/g, ''), 'hex'),
  position3:   Buffer.from('3305320394 5C 02 00 CA'.replace(/\s/g, ''), 'hex'),
  position4:   Buffer.from('3305320394 5C 03 00 CB'.replace(/\s/g, ''), 'hex'),
  flat:        Buffer.from('3305320A94 5C 04 00 CC'.replace(/\s/g, ''), 'hex'),
};

const BUTTONS = [
  { key: 'vibrate1',    label: 'Vibrate 1'    },
  { key: 'vibrate2',    label: 'Vibrate 2'    },
  { key: 'vibrate3',    label: 'Vibrate 3'    },
  { key: 'vibrate4',    label: 'Vibrate 4'    },
  { key: 'vibrateStop', label: 'Vibrate Stop' },
  { key: 'position1',   label: 'Position 1'   },
  { key: 'position2',   label: 'Position 2'   },
  { key: 'position3',   label: 'Position 3'   },
  { key: 'position4',   label: 'Position 4'   },
  { key: 'flat',        label: 'Flat'         },
];

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TempurPedicPlatform);
};

class TempurPedicPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config;
    this.cachedAccessories = new Map();

    this.api.on('didFinishLaunching', () => {
      this._syncAccessories();
    });
  }

  configureAccessory(accessory) {
    this.log.info(`[TempurPedic] Loading cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  _syncAccessories() {
    const bases = this.config.bases;

    if (!bases || bases.length === 0) {
      this.log.warn('[TempurPedic] No bases defined in config.');
      return;
    }

    const expectedUUIDs = new Set();

    for (const base of bases) {
      if (!base.name || !base.ip) {
        this.log.error('[TempurPedic] Each base needs "name" and "ip".');
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${base.ip}`);
      expectedUUIDs.add(uuid);

      let accessory = this.cachedAccessories.get(uuid);

      if (accessory) {
        this.log.info(`[TempurPedic] Restoring: ${base.name}`);
      } else {
        this.log.info(`[TempurPedic] Creating: ${base.name}`);
        accessory = new this.api.platformAccessory(base.name, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.set(uuid, accessory);
      }

      accessory.displayName = base.name;
      this._configureAccessory(accessory, base);
    }

    for (const [uuid, accessory] of this.cachedAccessories) {
      if (!expectedUUIDs.has(uuid)) {
        this.log.info(`[TempurPedic] Removing stale: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.delete(uuid);
      }
    }
  }

  _sendCommand(ip, commandKey, log) {
    const payload = COMMANDS[commandKey];
    if (!payload) {
      log.error(`[TempurPedic] Unknown command: ${commandKey}`);
      return;
    }

    const client = dgram.createSocket('udp4');

    client.send(payload, 0, payload.length, UDP_PORT, ip, (err) => {
      if (err) {
        log.error(`[TempurPedic] UDP send failed: ${err.message}`);
      } else {
        log.debug(`[TempurPedic] UDP sent ${commandKey} to ${ip}:${UDP_PORT}`);
      }
      client.close();
    });
  }

  _configureAccessory(accessory, base) {
    const { Service, Characteristic } = this.api.hap;
    const delay = parseInt(base.delay) || 1000;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Name,             base.name)
      .setCharacteristic(Characteristic.Manufacturer,     'Tempur-Pedic')
      .setCharacteristic(Characteristic.Model,            'Smart Base')
      .setCharacteristic(Characteristic.SerialNumber,     base.ip)
      .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0');

    for (const button of BUTTONS) {
      // Skip if explicitly disabled in config
      const enableKey = 'enable' + button.key.charAt(0).toUpperCase() + button.key.slice(1);
      const enabled = base[enableKey] !== false;

      if (!enabled) {
        const existing = accessory.getServiceById(Service.Switch, button.key);
        if (existing) {
          accessory.removeService(existing);
          this.log.info(`[TempurPedic] Removed disabled switch: ${button.label}`);
        }
        continue;
      }

      const serviceName = button.label;
      let svc = accessory.getServiceById(Service.Switch, button.key);

      if (!svc) {
        svc = accessory.addService(Service.Switch, serviceName, button.key);
      }

      svc.displayName = serviceName;
      svc.setCharacteristic(Characteristic.Name, serviceName);

      if (Characteristic.ConfiguredName) {
        svc.setCharacteristic(Characteristic.ConfiguredName, serviceName);
      }

      svc.setPrimaryService(false);

      svc.getCharacteristic(Characteristic.On)
        .onGet(() => false)
        .onSet((value) => {
          if (!value) return;

          this.log.info(`[TempurPedic] ${base.name} → ${button.label}`);
          this._sendCommand(base.ip, button.key, this.log);

          setTimeout(() => {
            svc.updateCharacteristic(Characteristic.On, false);
          }, delay);
        });
    }
  }
}
