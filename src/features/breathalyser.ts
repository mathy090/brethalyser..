import { BleManager, Device, State } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const TX_UUID      = "12345678-1234-1234-1234-123456789abd";
const RX_UUID      = "12345678-1234-1234-1234-123456789abe";
const STORAGE_KEY_DEVICE_ID = "@blowsafe_last_device_id";

const manager = new BleManager();

export type DeviceStatus =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'warmup'
  | 'ready'
  | 'scanning_bac'
  | 'recalibrating'
  | 'error';

export type BreathalyserEvent =
  | { type: 'ble_state'; state: State }
  | { type: 'scan_result'; devices: { id: string; name: string }[] }
  | { type: 'status'; status: DeviceStatus; deviceId?: string; message?: string }
  | { type: 'reading'; value: string };

let listeners: ((event: BreathalyserEvent) => void)[] = [];
let connectedDevice: Device | null = null;
let activeScan = false;

manager.onStateChange((state) => {
  breathalyser.emit({ type: 'ble_state', state });
}, true);

export const breathalyser = {
  on: (callback: (event: BreathalyserEvent) => void) => {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter(l => l !== callback);
    };
  },

  emit: (event: BreathalyserEvent) => {
    [...listeners].forEach(l => l(event));
  },

  initialize: async () => {},

  scan: async () => {
    if (activeScan) return;
    activeScan = true;

    try {
      manager.stopDeviceScan();
    } catch (_) {}

    breathalyser.emit({ type: 'status', status: 'scanning' });

    const seenIds = new Set<string>();

    manager.startDeviceScan(null, { allowDuplicates: false }, (_error, device) => {
      // Ignore errors silently — only surface timeout/connected to the UI
      if (!device || !activeScan) return;

      const name = device.name ?? device.localName ?? '';
      if (name.includes('BlowSafe')) {
        if (!seenIds.has(device.id)) {
          seenIds.add(device.id);
          breathalyser.emit({
            type: 'scan_result',
            devices: [{ id: device.id, name }],
          });
        }
      }
    });
  },

  stopScan: async () => {
    activeScan = false;
    try {
      manager.stopDeviceScan();
    } catch (_) {}
  },

  connect: async (device: { id: string; name?: string }) => {
    const state = await manager.state();
    if (state !== State.PoweredOn) {
      breathalyser.emit({ type: 'status', status: 'error', message: 'Bluetooth is off' });
      throw new Error('Bluetooth is off');
    }

    await breathalyser.stopScan();
    breathalyser.emit({ type: 'status', status: 'connecting', deviceId: device.id });

    // 15-second connection timeout
    const connectionTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out')), 15000)
    );

    const doConnect = async () => {
      const connected = await manager.connectToDevice(device.id, {
        autoConnect: false,
        requestMTU: 512,
      });

      connectedDevice = connected;

      connected.onDisconnected((_err, dev) => {
        connectedDevice = null;
        breathalyser.emit({ type: 'status', status: 'disconnected', deviceId: dev?.id });
      });

      await connected.discoverAllServicesAndCharacteristics();

      connected.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_UUID,
        (_err, characteristic) => {
          if (!characteristic?.value) return;
          try {
            const raw = atob(characteristic.value);
            raw.split('\n').forEach(line => {
              const msg = line.trim();
              if (msg) breathalyser.emit({ type: 'reading', value: msg });
            });
          } catch (_) {}
        }
      );

      await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, device.id);
      breathalyser.emit({ type: 'status', status: 'connected', deviceId: device.id });
    };

    try {
      await Promise.race([doConnect(), connectionTimeout]);
    } catch (err: any) {
      connectedDevice = null;
      // Only emit error for timeout; ignore BLE cancelled/internal errors
      if (err.message === 'Connection timed out') {
        breathalyser.emit({ type: 'status', status: 'error', message: 'Connection timed out' });
      }
      throw err;
    }
  },

  sendCommand: async (cmd: string) => {
    if (!connectedDevice) return;
    try {
      await connectedDevice.writeCharacteristicWithoutResponseForService(
        SERVICE_UUID,
        RX_UUID,
        Buffer.from(cmd).toString('base64')
      );
    } catch (_) {}
  },

  disconnect: async () => {
    try {
      if (connectedDevice) {
        await connectedDevice.cancelConnection();
        connectedDevice = null;
      }
      await AsyncStorage.removeItem(STORAGE_KEY_DEVICE_ID);
    } catch (_) {}
    breathalyser.emit({ type: 'status', status: 'disconnected' });
  },

  isStillConnected: async (): Promise<boolean> => {
    if (!connectedDevice) return false;
    try {
      const devices = await manager.connectedDevices([SERVICE_UUID]);
      return devices.some(d => d.id === connectedDevice?.id);
    } catch (_) {
      return false;
    }
  },

  getLastConnectedDeviceId: async (): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID);
    } catch (_) {
      return null;
    }
  },

  requestScan: async () => {
    await breathalyser.sendCommand('SCAN');
  },
};

export interface ScannedDevice {
  id: string;
  name: string;
}