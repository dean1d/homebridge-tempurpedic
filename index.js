'use strict';

const dgram = require('dgram');
const { execFile } = require('child_process');
const { version: PLUGIN_VERSION } = require('./package.json');

const PLUGIN_NAME   = 'homebridge-tempurpedic';
const PLATFORM_NAME = 'TempurPedic';
const UDP_PORT      = 50007;
const CONNECTIVITY_TIMEOUT = 2000;

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
    this._connectivityStates = new Map();
    this._connectivityTimers = new Map();
    this._probeProcesses = new Set();
    this._pingUnavailableWarned = new Set();
    this._matterCachedAccessories = new Map();

    this.api.on('didFinishLaunching', () => {
      this._syncAccessories();
    });
    this.api.on('shutdown', () => this._stopConnectivityMonitoring());
  }

  configureAccessory(accessory) {
    this.log.info(`[TempurPedic] Loading cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  // Matter equivalent of configureAccessory — called for every Matter accessory
  // restored from cache on startup, so we know which UUIDs already exist and
  // must be updated in place rather than re-registered (see _registerMatterAccessories).
  configureMatterAccessory(accessory) {
    this.log.info(`[TempurPedic] Loading cached Matter accessory: ${accessory.displayName}`);
    this._matterCachedAccessories.set(accessory.UUID, accessory);
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
      this._startConnectivityMonitoring(base);
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

    const existingSensor = accessory.getServiceById(Service.ContactSensor, 'connectivity');
    if (base.enableConnectivitySensor === false) {
      if (existingSensor) accessory.removeService(existingSensor);
      return;
    }

    const sensorName = this._connectivitySensorName(base);
    const state = this._connectivityState(base);
    const sensor = existingSensor || accessory.addService(Service.ContactSensor, sensorName, 'connectivity');
    sensor.displayName = sensorName;
    sensor.setCharacteristic(Characteristic.Name, sensorName);
    if (Characteristic.ConfiguredName) sensor.setCharacteristic(Characteristic.ConfiguredName, sensorName);
    const contactState = sensor.getCharacteristic(Characteristic.ContactSensorState);
    contactState.removeAllListeners('get');
    contactState.on('get', callback => callback(null, state.connected
      ? Characteristic.ContactSensorState.CONTACT_DETECTED
      : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED));
    state.hap = { sensor, Characteristic };
  }

  // ── Matter ─────────────────────────────────────────────────────────────────

  async _registerMatterAccessories(bases) {
    const matter = this.api.matter;
    const allAccessories = [];

    for (const base of bases) {
      if (!base.name || !base.ip) continue;

      const enabledButtons = this._enabledButtons(base);
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

      allAccessories.push(...accessories);

      if (base.enableConnectivitySensor !== false) {
        const state = this._connectivityState(base);
        const uuid = matter.uuid.generate(`${PLUGIN_NAME}:matter:${base.ip}:connectivity`);
        state.matterUuid = uuid;
        allAccessories.push(associateMatterAccessory({
          UUID: uuid,
          displayName: `${base.name} ${this._connectivitySensorName(base)}`,
          deviceType: matter.deviceTypes.ContactSensor,
          serialNumber: `${base.ip}-connectivity`,
          manufacturer: 'Tempur-Pedic',
          model: 'Smart Base Connectivity',
          firmwareRevision: PLUGIN_VERSION,
          clusters: { booleanState: { stateValue: state.connected } },
        }));
      }
    }

    if (allAccessories.length === 0) return;

    const expectedUUIDs = new Set(allAccessories.map(a => a.UUID));
    const newAccessories = allAccessories.filter(a => !this._matterCachedAccessories.has(a.UUID));
    const existingAccessories = allAccessories.filter(a => this._matterCachedAccessories.has(a.UUID));

    // Register the complete, deterministic set of brand-new endpoints in one call.
    // Sending one accessory per call can expose a partial bridge topology while
    // Homebridge is starting, which some controllers treat as removals/additions.
    if (newAccessories.length > 0) {
      await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories);
      this.log.info(`[TempurPedic] Registered ${newAccessories.length} new Matter accessories.`);
    }

    // Accessories already known from a previous run must NOT be re-registered —
    // registerPlatformAccessories behaves like HAP's, so calling it again for an
    // existing UUID recreates the endpoint and drops any commissioning/binding a
    // controller (e.g. Alexa) already holds for it. updatePlatformAccessories
    // refreshes handlers/state in place without disturbing that identity.
    if (existingAccessories.length > 0) {
      await matter.updatePlatformAccessories(existingAccessories);
      this.log.info(`[TempurPedic] Updated ${existingAccessories.length} existing Matter accessories.`);
    }

    for (const accessory of allAccessories) {
      this._matterCachedAccessories.set(accessory.UUID, accessory);
    }

    const staleUUIDs = [...this._matterCachedAccessories.keys()].filter(uuid => !expectedUUIDs.has(uuid));
    if (staleUUIDs.length > 0) {
      const staleAccessories = staleUUIDs.map(uuid => this._matterCachedAccessories.get(uuid));
      await matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
      for (const uuid of staleUUIDs) this._matterCachedAccessories.delete(uuid);
      this.log.info(`[TempurPedic] Removed ${staleAccessories.length} stale Matter accessories.`);
    }
  }

  // ── UDP ────────────────────────────────────────────────────────────────────

  _connectivitySensorName(base) {
    const configured = typeof base.connectivitySensorName === 'string'
      ? base.connectivitySensorName.trim()
      : '';
    return configured || 'Bed Connectivity';
  }

  _connectivityState(base) {
    if (!this._connectivityStates.has(base.ip)) {
      this._connectivityStates.set(base.ip, { connected: true, failures: 0, checking: false });
    }
    return this._connectivityStates.get(base.ip);
  }

  _startConnectivityMonitoring(base) {
    const existing = this._connectivityTimers.get(base.ip);
    if (existing) clearInterval(existing);
    this._connectivityTimers.delete(base.ip);
    if (base.enableConnectivitySensor === false) return;

    const intervalSeconds = Math.max(5, parseInt(base.connectivityCheckInterval) || 30);
    void this._checkConnectivity(base);
    const timer = setInterval(() => void this._checkConnectivity(base), intervalSeconds * 1000);
    if (timer.unref) timer.unref();
    this._connectivityTimers.set(base.ip, timer);
  }

  async _checkConnectivity(base) {
    const state = this._connectivityState(base);
    if (state.checking) return;
    state.checking = true;
    try {
      const { reachable, spawnFailure, error } = await this._probePing(base.ip);
      if (spawnFailure) {
        if (!this._pingUnavailableWarned.has(base.ip)) {
          this._pingUnavailableWarned.add(base.ip);
          this.log.error(`[TempurPedic] ${base.name}: could not run "ping" (${error.code}). Connectivity sensor left unchanged until this is resolved — install/enable ping, grant it network permissions, or set enableConnectivitySensor to false.`);
        }
        return;
      }
      if (reachable) {
        state.failures = 0;
        await this._setConnectivity(base, true);
      } else {
        state.failures += 1;
        const threshold = Math.max(1, parseInt(base.connectivityFailureThreshold) || 3);
        if (state.failures >= threshold) await this._setConnectivity(base, false);
      }
    } finally {
      state.checking = false;
    }
  }

  _probePing(ip, timeout = CONNECTIVITY_TIMEOUT) {
    return new Promise((resolve) => {
      const timeoutArg = process.platform === 'linux'
        ? String(Math.max(1, Math.ceil(timeout / 1000)))
        : String(timeout);
      const args = process.platform === 'win32'
        ? ['-n', '1', '-w', timeoutArg, ip]
        : ['-c', '1', '-W', timeoutArg, ip];

      let child;
      child = execFile('ping', args, { timeout: timeout + 1000, windowsHide: true }, (error) => {
        this._probeProcesses.delete(child);
        // A string error.code (e.g. ENOENT, EACCES) means the `ping` binary itself
        // could not be spawned — distinct from a non-zero exit for an unreachable
        // host, which execFile reports with a numeric error.code (the exit code).
        const spawnFailure = !!error && typeof error.code === 'string';
        resolve({ reachable: !error, spawnFailure, error });
      });
      this._probeProcesses.add(child);
    });
  }

  async _setConnectivity(base, connected) {
    const state = this._connectivityState(base);
    const changed = state.connected !== connected;
    state.connected = connected;

    if (state.hap) {
      const { sensor, Characteristic } = state.hap;
      sensor.updateCharacteristic(
        Characteristic.ContactSensorState,
        connected
          ? Characteristic.ContactSensorState.CONTACT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      );
    }

    if (state.matterUuid && this.api.isMatterEnabled && this.api.isMatterEnabled()) {
      try {
        await this.api.matter.updateAccessoryState(
          state.matterUuid,
          'booleanState',
          { stateValue: connected },
        );
      } catch (err) {
        this.log.debug(`[TempurPedic] Matter connectivity update deferred: ${err.message}`);
      }
    }

    if (changed) {
      this.log[connected ? 'info' : 'warn'](
        `[TempurPedic] ${base.name} connectivity: ${connected ? 'connected (contact closed)' : 'unavailable (contact open)'}`,
      );
    }
  }

  _stopConnectivityMonitoring() {
    for (const timer of this._connectivityTimers.values()) clearInterval(timer);
    this._connectivityTimers.clear();
    for (const child of this._probeProcesses) child.kill();
    this._probeProcesses.clear();
  }

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
