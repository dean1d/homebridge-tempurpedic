'use strict';

const dgram = require('dgram');
const { version: PLUGIN_VERSION } = require('./package.json');

const PLUGIN_NAME   = 'homebridge-tempurpedic';
const PLATFORM_NAME = 'TempurPedic';
const UDP_PORT      = 50007;

function associateMatterAccessory(accessory) {
  // Homebridge 2.2+ serializes these ownership fields in its Matter cache.
  // Supplying them prevents registered devices from being treated as orphaned
  // and removed after Homebridge restarts.
  accessory._associatedPlugin = PLUGIN_NAME;
  accessory._associatedPlatform = PLATFORM_NAME;
  return accessory;
}

const COMMANDS = {
  vibrate1:    Buffer.from('3305320394' + '8D007861', 'hex'),
  vibrate2:    Buffer.from('3305320394' + '8D017860', 'hex'),
  vibrate3:    Buffer.from('3305320394' + '8D027863', 'hex'),
  vibrate4:    Buffer.from('3305320394' + '8D037862', 'hex'),
  vibrateStop: Buffer.from('3305320A94' + '86000012', 'hex'),
  position1:   Buffer.from('3305320394' + '5C0000C8', 'hex'),
  position2:   Buffer.from('3305320394' + '5C0100C9', 'hex'),
  position3:   Buffer.from('3305320394' + '5C0200CA', 'hex'),
  position4:   Buffer.from('3305320394' + '5C0300CB', 'hex'),
  flat:        Buffer.from('3305320A94' + '5C0400CC', 'hex'),
};

// vibrationNaming controls the label shown in HomeKit.
// 'vibrate'   → Vibrate 1, Vibrate 2, Vibrate 3, Vibrate 4
// 'vibration' → Vibration 1, Vibration 2, Vibration 3, Vibration 4
// 'both'      → Vibrate 1, Vibrate 2, Vibrate 3, Vibrate 4,
//               Vibration 1, Vibration 2, Vibration 3, Vibration 4
// The enable checkboxes are always named enableVibrate1-4 regardless.
function buildButtons(naming = 'vibrate') {
  const buttons = [];

  for (let i = 1; i <= 4; i++) {
    // Primary label based on naming preference
    if (naming === 'vibrate' || naming === 'both') {
      buttons.push({
        key:       `vibrate${i}`,
        enableKey: `enableVibrate${i}`,
        label:     `Vibrate ${i}`,
        command:   `vibrate${i}`,
      });
    }
    if (naming === 'vibration' || naming === 'both') {
      buttons.push({
        key:       `vibration${i}`,
        enableKey: `enableVibrate${i}`,  // same checkbox controls both
        label:     `Vibration ${i}`,
        command:   `vibrate${i}`,
      });
    }
  }

  if (naming === 'vibrate' || naming === 'both') {
    buttons.push({ key: 'vibrateStop',   enableKey: 'enableVibrateStop', label: 'Stop Vibrate',    command: 'vibrateStop' });
  }
  if (naming === 'vibration' || naming === 'both') {
    buttons.push({ key: 'vibrationStop', enableKey: 'enableVibrateStop', label: 'Stop Vibration',  command: 'vibrateStop' });
  }
  buttons.push(
    { key: 'position1',   enableKey: 'enablePosition1',   label: 'Position 1',     command: 'position1'   },
    { key: 'position2',   enableKey: 'enablePosition2',   label: 'Position 2',     command: 'position2'   },
    { key: 'position3',   enableKey: 'enablePosition3',   label: 'Position 3',     command: 'position3'   },
    { key: 'position4',   enableKey: 'enablePosition4',   label: 'Position 4',     command: 'position4'   },
    { key: 'flat',        enableKey: 'enableFlat',        label: 'Bed Flat',       command: 'flat'        },
  );

  return buttons;
}

const BUTTON_NAME_CONFIG_KEYS = {
  vibrate1:    'vibrate1Name',
  vibrate2:    'vibrate2Name',
  vibrate3:    'vibrate3Name',
  vibrate4:    'vibrate4Name',
  vibrateStop: 'vibrateStopName',
  position1:   'position1Name',
  position2:   'position2Name',
  position3:   'position3Name',
  position4:   'position4Name',
  flat:        'flatName',
};

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

  _enabledButtons(base) {
    return buildButtons(base.vibrationNaming || 'vibrate')
      .filter(button => base[button.enableKey] !== false)
      .map(button => {
        const nameKey = BUTTON_NAME_CONFIG_KEYS[button.command];
        const customName = nameKey && typeof base[nameKey] === 'string'
          ? base[nameKey].trim()
          : '';

        return customName ? { ...button, label: customName } : button;
      });
  }

  _syncAccessories() {
    // Map of "ip:buttonKey" → HAP service, so Matter handlers can update HAP state too
    this._hapServices = this._hapServices || new Map();
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
      this._configureHAPAccessory(accessory, base);
    }

    if (this.api.isMatterEnabled && this.api.isMatterEnabled()) {
      this.log.info('[TempurPedic] Matter is enabled — registering Matter accessories');
      this._registerMatterAccessories(bases).catch((err) => {
        this.log.error(`[TempurPedic] Matter accessory registration failed: ${err.message}`);
      });
    }

    for (const [uuid, accessory] of this.cachedAccessories) {
      if (!expectedUUIDs.has(uuid)) {
        this.log.info(`[TempurPedic] Removing stale: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.delete(uuid);
      }
    }
  }

  // ── HomeKit (HAP) ──────────────────────────────────────────────────────────

  _configureHAPAccessory(accessory, base) {
    const { Service, Characteristic } = this.api.hap;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Name,             base.name)
      .setCharacteristic(Characteristic.Manufacturer,     'Tempur-Pedic')
      .setCharacteristic(Characteristic.Model,            'Smart Base')
      .setCharacteristic(Characteristic.SerialNumber,     base.ip)
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    const enabledButtons = this._enabledButtons(base);
    const activeKeys = new Set(enabledButtons.map(b => b.key));

    // Remove any stale services (disabled or naming changed)
    const allPossible = buildButtons('both');
    for (const button of allPossible) {
      if (!activeKeys.has(button.key)) {
        const existing = accessory.getServiceById(Service.Switch, button.key);
        if (existing) {
          accessory.removeService(existing);
          this.log.info(`[TempurPedic] Removed switch: ${button.label}`);
        }
      }
    }

    for (const button of enabledButtons) {
      let svc = accessory.getServiceById(Service.Switch, button.key);
      if (!svc) svc = accessory.addService(Service.Switch, button.label, button.key);

      svc.displayName = button.label;
      svc.setCharacteristic(Characteristic.Name, button.label);
      if (Characteristic.ConfiguredName) {
        svc.setCharacteristic(Characteristic.ConfiguredName, button.label);
      }
      svc.setPrimaryService(false);

      // Store reference so Matter handlers can also reset this HAP switch
      this._hapServices.set(`${base.ip}:${button.key}`, { svc, Characteristic });

      const char = svc.getCharacteristic(Characteristic.On);

      // Use .on() directly instead of .onGet()/.onSet() so removeAllListeners
      // correctly removes all handlers before re-registering — prevents stacking
      char.removeAllListeners('get');
      char.removeAllListeners('set');

      char.on('get', (callback) => {
        callback(null, false);
      });

      char.on('set', (value, callback) => {
        callback(null);
        if (!value) {
          this.log.debug(`[TempurPedic] ${base.name} → ${button.label} OFF`);
          return;
        }
        this.log.info(`[TempurPedic] ${base.name} → ${button.label} ON`);
        this._sendCommand(base.ip, button.command);
        setTimeout(() => {
          this.log.info(`[TempurPedic] ${base.name} → ${button.label} OFF (auto-reset)`);
          svc.updateCharacteristic(Characteristic.On, false);
        }, parseInt(base.delay) || 1000);
      });
    }
  }

  // ── Matter ─────────────────────────────────────────────────────────────────

  async _registerMatterAccessories(bases) {
    const matter = this.api.matter;
    let registered = 0;
    let expected = 0;

    for (const base of bases) {
      if (!base.name || !base.ip) continue;

      const enabledButtons = this._enabledButtons(base);
      if (enabledButtons.length === 0) continue;
      expected += enabledButtons.length;

      const delay = parseInt(base.delay) || 1000;

      const accessories = enabledButtons.map(button => {
        const uuid = matter.uuid.generate(`${PLUGIN_NAME}:matter:${base.ip}:${button.key}`);

        const deviceType = matter.deviceTypes.OnOffOutlet;

        return associateMatterAccessory({
          UUID:             uuid,
          displayName:      `${base.name} ${button.label}`,
          deviceType,
          serialNumber:     `${base.ip}-${button.key}`,
          manufacturer:     'Tempur-Pedic',
          model:            'Smart Base',
          firmwareRevision: PLUGIN_VERSION,
          clusters: { onOff: { onOff: false } },
          handlers: {
            onOff: {
              on: async (args, context) => {
                this.log.info(`[TempurPedic] Matter: ${base.name} → ${button.label} ON`);
                this._sendCommand(base.ip, button.command);

                // Auto-reset both Matter and HAP state after delay
                setTimeout(async () => {
                  // Reset Matter state
                  try {
                    await matter.updateAccessoryState(uuid, 'onOff', { onOff: false });
                    await new Promise(resolve => setTimeout(resolve, 100));

                    let state = await matter.getAccessoryState(uuid, 'onOff');
                    for (const retryDelay of [250, 500]) {
                      if (state && state.onOff === false) break;

                      await matter.updateAccessoryState(uuid, 'onOff', { onOff: false });
                      await new Promise(resolve => setTimeout(resolve, retryDelay));
                      state = await matter.getAccessoryState(uuid, 'onOff');
                    }

                    if (!state || state.onOff !== false) {
                      throw new Error(`Off state was not confirmed (state: ${state ? state.onOff : 'unavailable'})`);
                    }
                    this.log.info(`[TempurPedic] Matter: ${base.name} → ${button.label} OFF (auto-reset)`);
                  } catch (e) {
                    this.log.warn(`[TempurPedic] Matter state reset was not confirmed: ${e.message}`);
                  }
                  // Also reset the corresponding HAP switch so HomeKit shows Off
                  const hapRef = this._hapServices && this._hapServices.get(`${base.ip}:${button.key}`);
                  if (hapRef) {
                    hapRef.svc.updateCharacteristic(hapRef.Characteristic.On, false);
                  }
                }, delay);
              },
              off: async () => {
                this.log.debug(`[TempurPedic] Matter: ${base.name} → ${button.label} OFF`);
              },
            },
          },
        });
      });

      for (const accessory of accessories) {
        try {
          await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          registered++;
        } catch (err) {
          this.log.warn(
            `[TempurPedic] Matter accessory registration failed for ${accessory.displayName}: ${err.message}`,
          );
        }
      }
    }

    this.log.info(`[TempurPedic] Registered ${registered} of ${expected} Matter accessories.`);
  }

  // ── UDP ────────────────────────────────────────────────────────────────────

  _sendCommand(ip, commandKey) {
    const payload = COMMANDS[commandKey];
    if (!payload) {
      this.log.error(`[TempurPedic] Unknown command: ${commandKey}`);
      return;
    }

    const client = dgram.createSocket('udp4');
    let closed = false;
    const closeClient = () => {
      if (closed) return;
      closed = true;
      client.close();
    };

    client.once('error', (err) => {
      this.log.error(`[TempurPedic] UDP socket error: ${err.message}`);
      closeClient();
    });

    client.send(payload, 0, payload.length, UDP_PORT, ip, (err) => {
      if (err) {
        this.log.error(`[TempurPedic] UDP send failed: ${err.message}`);
      } else {
        this.log.debug(`[TempurPedic] UDP sent ${commandKey} to ${ip}:${UDP_PORT}`);
      }
      closeClient();
    });
  }
}
