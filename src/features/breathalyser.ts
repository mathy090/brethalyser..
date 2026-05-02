/**
 * src/features/breathalyser.ts
 *
 * BLE interface for Arduino R4 Breathalyser.
 * Handles scanning, connection, command sending, and event emission.
 */

import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encode as btoa } from 'base-64'; // 🔧 FIX #4: Safe base64 for RN

// ─── BLE UUIDs (must match Arduino firmware exactly) ─────────────────────────
const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const TX_UUID      = "12345678-1234-1234-1234-123456789abd"; // Arduino → App
const RX_UUID      = "12345678-1234-1234-1234-123456789abe"; // App → Arduino
const STORAGE_KEY_DEVICE_ID = "@blowsafe_last_device_id";

const manager = new BleManager();

// ─── Types ───────────────────────────────────────────────────────────────────
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

// ─── Internal State ──────────────────────────────────────────────────────────
let listeners: ((event: BreathalyserEvent) => void)[] = [];
let connectedDevice: Device | null = null;
let activeScan = false;
let monitorSubscription: Subscription | null = null; // 🔧 FIX #9: Track monitor sub

// ─── BLE State Change Listener ───────────────────────────────────────────────
manager.onStateChange((state) => {
  breathalyser.emit({ type: 'ble_state', state });
}, true);

// ─── Public API ──────────────────────────────────────────────────────────────
export const breathalyser = {
  on: (callback: (event: BreathalyserEvent) => void) => {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter(l => l !== callback);
    };
  },

  emit: (event: BreathalyserEvent) => {
    [...listeners].forEach(l => {
      try { l(event); } catch (err) { console.error('Listener error:', err); }
    });
  },

  initialize: async () => {},

  scan: async () => {
    if (activeScan) return;
    activeScan = true;
    try { manager.stopDeviceScan(); } catch (_) {}
    breathalyser.emit({ type: 'status', status: 'scanning' });

    const seenIds = new Set<string>();
    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error || !device || !activeScan) return;
      const name = device.name ?? device.localName ?? '';
      if (name.includes('BlowSafe') && !seenIds.has(device.id)) {
        seenIds.add(device.id);
        breathalyser.emit({ type: 'scan_result', devices: [{ id: device.id, name }] });
      }
    });
  },

  stopScan: async () => {
    activeScan = false;
    try { manager.stopDeviceScan(); } catch (_) {}
  },

  connect: async (device: { id: string; name?: string }) => {
    const state = await manager.state();
    if (state !== State.PoweredOn) {
      breathalyser.emit({ type: 'status', status: 'error', message: 'Bluetooth is off' });
      throw new Error('Bluetooth is off');
    }

    await breathalyser.stopScan(); // 🔧 FIX #1: Stop scan before connect
    breathalyser.emit({ type: 'status', status: 'connecting', deviceId: device.id });

    const connectionTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out')), 15000)
    );

    const doConnect = async () => {
      const connected = await manager.connectToDevice(device.id, {
        autoConnect: false,
        requestMTU: 185, // 🔧 FIX #10: Safer MTU for Android compatibility
      });

      connectedDevice = connected;

      connected.onDisconnected((_err, dev) => {
        connectedDevice = null;
        monitorSubscription?.remove(); // 🔧 FIX #9: Clean monitor on disconnect
        monitorSubscription = null;
        breathalyser.emit({ type: 'status', status: 'disconnected', deviceId: dev?.id, message: 'Device disconnected' });
      });

      await connected.discoverAllServicesAndCharacteristics();

      // 🔧 FIX #9: Remove old subscription before creating new one
      monitorSubscription?.remove();
      monitorSubscription = null;

      // 🔧 FIX #6: Handle monitor errors properly
      monitorSubscription = connected.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_UUID,
        (err, characteristic) => {
          if (err) {
            console.error("BLE Monitor Error:", err);
            return;
          }
          if (!characteristic?.value) return;
          
          try {
            const raw = atob(characteristic.value);
            raw.split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .forEach(msg => {
                console.log(`[BLE RX] ${msg}`);
                breathalyser.emit({ type: 'reading', value: msg });
              });
          } catch (decodeErr) {
            console.error('Failed to decode BLE message:', decodeErr);
          }
        }
      );

      await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, device.id);
      breathalyser.emit({ type: 'status', status: 'connected', deviceId: device.id, message: 'Connected successfully' });
    };

    try {
      await Promise.race([doConnect(), connectionTimeout]);
    } catch (err: any) {
      connectedDevice = null;
      monitorSubscription?.remove();
      monitorSubscription = null;
      if (err.message === 'Connection timed out') {
        breathalyser.emit({ type: 'status', status: 'error', message: 'Connection timed out. Move closer to device.' });
      }
      throw err;
    }
  },

  sendCommand: async (cmd: string): Promise<void> => {
    if (!connectedDevice) {
      console.error('sendCommand failed: No device connected');
      throw new Error('DEVICE_NOT_CONNECTED');
    }
    try {
      // 🔧 FIX #4: Use base-64 library instead of Buffer
      await connectedDevice.writeCharacteristicWithoutResponseForService(
        SERVICE_UUID,
        RX_UUID,
        btoa(cmd)
      );
      console.log(`[BLE TX] Command sent: ${cmd}`);
    } catch (error: any) {
      console.error('BLE Write Failed:', error?.message || error);
      throw new Error('COMMAND_SEND_FAILED');
    }
  },

  disconnect: async () => {
    try {
      if (connectedDevice) {
        await connectedDevice.cancelConnection();
        connectedDevice = null;
      }
      monitorSubscription?.remove();
      monitorSubscription = null;
      await AsyncStorage.removeItem(STORAGE_KEY_DEVICE_ID);
    } catch (err) {
      console.error('Disconnect cleanup error:', err);
    }
    breathalyser.emit({ type: 'status', status: 'disconnected', message: 'Disconnected' });
  },

  isStillConnected: async (): Promise<boolean> => {
    if (!connectedDevice) return false;
    try {
      const devices = await manager.connectedDevices([SERVICE_UUID]);
      return devices.some(d => d.id === connectedDevice?.id);
    } catch (err) {
      console.error('Connection check failed:', err);
      return false;
    }
  },

  getLastConnectedDeviceId: async (): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID);
    } catch (err) {
      console.error('Failed to read last device ID:', err);
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