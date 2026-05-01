import { BleManager, Device, State } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc"; 
const TX_UUID = "12345678-1234-1234-1234-123456789abd";
const RX_UUID = "12345678-1234-1234-1234-123456789abe";
const STORAGE_KEY_DEVICE_ID = "@blowsafe_last_device_id";

const manager = new BleManager();

export type BreathalyserEvent = 
  | { type: 'ble_state'; state: State }
  | { type: 'scan_result'; devices: { id: string; name: string }[] }
  | { type: 'status'; status: 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'error'; deviceId?: string; message?: string }
  | { type: 'reading'; value: string };

let listeners: ((event: BreathalyserEvent) => void)[] = [];
let connectedDevice: Device | null = null;
let isScanning = false;

manager.onStateChange((state) => {
  if (listeners.length > 0) {
    breathalyser.emit({ type: 'ble_state', state });
  }
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
    // If already scanning, return silently (no error)
    if (isScanning) return;

    // Reset guard before starting
    isScanning = true;

    try {
      await manager.stopDeviceScan(); // stop any existing scan
    } catch (e) {
      // ignore
    }

    breathalyser.emit({ type: 'status', status: 'scanning' });

    const seenIds = new Set<string>();

    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        // Only emit an error if we're still actively scanning (guard against stale callbacks)
        if (isScanning) {
          console.warn("Scan Error:", error.message);
          breathalyser.emit({ type: 'status', status: 'error', message: error.message });
          // Fail-safe: stop scanning and allow retry
          manager.stopDeviceScan();
          isScanning = false;
        }
        return;
      }

      if (device && isScanning) {
        const name = device.name || device.localName;
        if (name && name.includes("BlowSafe")) {
          if (!seenIds.has(device.id)) {
            seenIds.add(device.id);
            breathalyser.emit({ 
              type: 'scan_result', 
              devices: [{ id: device.id, name: name }] 
            });
          }
        }
      }
    });
  },

  stopScan: async () => {
    try {
      await manager.stopDeviceScan();
    } catch (e) {}
    isScanning = false;
  },

  connect: async (device: { id: string; name?: string }) => {
    const state = await manager.state();
    if (state === State.PoweredOff) throw new Error("Bluetooth is off");

    await breathalyser.stopScan();
    breathalyser.emit({ type: 'status', status: 'connecting', deviceId: device.id });

    try {
      const connected = await manager.connectToDevice(device.id, {
        autoConnect: true,
        requestMTU: 512,
      });
      connectedDevice = connected;

      connected.onDisconnected((error, dev) => {
        breathalyser.emit({
          type: 'status',
          status: 'disconnected',
          deviceId: dev?.id,
        });
      });

      await connected.discoverAllServicesAndCharacteristics();

      await connected.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_UUID,
        (error, characteristic) => {
          if (error) return;
          if (characteristic?.value) {
            const raw = atob(characteristic.value);
            raw.split('\n').forEach(line => {
              const msg = line.trim();
              if (msg) {
                breathalyser.emit({ type: 'reading', value: msg });
              }
            });
          }
        }
      );

      await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, device.id);
      breathalyser.emit({ type: 'status', status: 'connected', deviceId: device.id });

    } catch (error: any) {
      connectedDevice = null;
      breathalyser.emit({ type: 'status', status: 'error', message: error.message });
      throw error;
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
    } catch (e) {}
  },

  disconnect: async () => {
    try {
      if (connectedDevice) {
        await connectedDevice.cancelConnection();
        connectedDevice = null;
      }
      await AsyncStorage.removeItem(STORAGE_KEY_DEVICE_ID);
      breathalyser.emit({ type: 'status', status: 'disconnected' });
    } catch (e) {}
  },

  isStillConnected: async (): Promise<boolean> => {
    if (!connectedDevice) return false;
    try {
      const devices = await manager.connectedDevices([SERVICE_UUID]);
      return devices.some(d => d.id === connectedDevice?.id);
    } catch {
      return false;
    }
  },

  getLastConnectedDeviceId: async (): Promise<string | null> => {
    return await AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID);
  }
};

export interface ScannedDevice {
  id: string;
  name: string;
}