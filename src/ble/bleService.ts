import { PermissionsAndroid, Platform, Alert, Linking } from 'react-native';
import { BleManager, State, Device } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const TX_UUID = "12345678-1234-1234-1234-123456789abd";
const RX_UUID = "12345678-1234-1234-1234-123456789abe";
const DEVICE_NAME_FILTER = "BlowSafe";
const STORAGE_KEY = "@blowsafe_last_device_id";

const manager = new BleManager();
let connectedDevice: Device | null = null;
let isConnected = false;
let isReady = false;
let initPromise: Promise<void> | null = null;
let listeners: ((event: BLEEvent) => void)[] = [];

export type BLEEvent =
  | { type: 'ble_state'; state: State }
  | { type: 'scan_result'; devices: { id: string; name: string }[] }
  | { type: 'status'; status: 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'error'; deviceId?: string; message?: string }
  | { type: 'reading'; value: string };

export const initBLE = async (): Promise<void> => {
  if (isReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('🔌 Starting BLE Manager...');
      await manager.start();
      
      const state = await manager.state();
      console.log('📶 BLE State:', state);

      if (state === State.PoweredOff || state === State.Unknown) {
        throw new Error('BLUETOOTH_OFF');
      }
      if (state === State.Unauthorized || state === State.Unsupported) {
        throw new Error('BLE_UNAUTHORIZED');
      }
      if (state !== State.PoweredOn) {
        throw new Error('BLE_STATE_ERROR');
      }

      // Android permissions
      if (Platform.OS === 'android') {
        await ensurePermissions();
      }

      manager.onStateChange((s) => {
        emit({ type: 'ble_state', state: s });
        if (s !== State.PoweredOn) isReady = false;
      }, true);

      isReady = true;
      console.log('✅ BLE Ready');
    } catch (err: any) {
      isReady = false;
      initPromise = null; // Reset so retry works
      console.error('❌ BLE Init Error:', err.message || err);
      throw err;
    }
  })();

  return initPromise;
};

export const waitForBLEReady = async () => {
  if (isReady) return;
  if (!initPromise) throw new Error('BLUETOOTH_OFF');
  await initPromise;
};

export const onBLEEvent = (cb: (e: BLEEvent) => void) => {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
};

const emit = (event: BLEEvent) => {
  [...listeners].forEach(c => { try { c(event); } catch(e) {} });
};

export const startScan = async () => {
  await waitForBLEReady();
  await manager.stopDeviceScan();
  emit({ type: 'status', status: 'scanning' });
  const seen = new Set<string>();
  manager.startDeviceScan(null, null, (err, dev) => {
    if (err) { emit({ type: 'status', status: 'error', message: err.message }); manager.stopDeviceScan(); return; }
    if (dev) {
      const name = dev.name || dev.localName;
      if (name?.includes(DEVICE_NAME_FILTER) && !seen.has(dev.id)) {
        seen.add(dev.id);
        emit({ type: 'scan_result', devices: [{ id: dev.id, name }] });
      }
    }
  });
};

export const stopScan = async () => { try { await manager.stopDeviceScan(); } catch {} };

export const connectToDevice = async (device: { id: string; name?: string }) => {
  await waitForBLEReady();
  await manager.stopDeviceScan();
  emit({ type: 'status', status: 'connecting', deviceId: device.id });
  try {
    const connected = await manager.connectToDevice(device.id, { autoConnect: false, requestMTU: 512 });
    connectedDevice = connected;
    connected.onDisconnected(() => {
      isConnected = false; connectedDevice = null;
      emit({ type: 'status', status: 'disconnected' });
    });
    await connected.discoverAllServicesAndCharacteristics();
    await connected.monitorCharacteristicForService(SERVICE_UUID, TX_UUID, (err, char) => {
      if (err || !char?.value) return;
      const raw = Buffer.from(char.value, 'base64').toString('utf8');
      raw.split('\n').forEach(line => {
        const msg = line.trim();
        if (msg) emit({ type: 'reading', value: msg });
      });
    });
    isConnected = true;
    await AsyncStorage.setItem(STORAGE_KEY, device.id);
    emit({ type: 'status', status: 'connected', deviceId: device.id });
  } catch (error: any) {
    isConnected = false; connectedDevice = null;
    emit({ type: 'status', status: 'error', message: error.message });
    throw error;
  }
};

export const sendCommand = async (cmd: string) => {
  await waitForBLEReady();
  if (!connectedDevice || !isConnected) throw new Error('Device not connected');
  await connectedDevice.writeCharacteristicWithoutResponseForService(
    SERVICE_UUID, RX_UUID, Buffer.from(cmd, 'utf8').toString('base64')
  );
};

export const disconnect = async () => {
  if (connectedDevice) await connectedDevice.cancelConnection();
  connectedDevice = null; isConnected = false;
  await AsyncStorage.removeItem(STORAGE_KEY);
  emit({ type: 'status', status: 'disconnected' });
};

export const isDeviceConnected = async () => {
  if (!isConnected || !connectedDevice) return false;
  try { return (await manager.connectedDevices([SERVICE_UUID])).some(d => d.id === connectedDevice?.id); } catch { return false; }
};

export const getLastDeviceId = async () => AsyncStorage.getItem(STORAGE_KEY);
export const getBLEState = async () => manager.state();

const ensurePermissions = async () => {
  if (Platform.Version < 23) return;
  const perms = Platform.Version >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    
  const granted = await PermissionsAndroid.requestMultiple(perms as any[]);
  const ok = perms.every(p => granted[p] === PermissionsAndroid.RESULTS.GRANTED);
  if (!ok) {
    if (Platform.Version >= 31) {
      Alert.alert('Permissions Required', 'Bluetooth permissions are required to scan devices.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() }
      ]);
    }
    throw new Error('PERMISSION_DENIED');
  }
};