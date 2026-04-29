import { BleManager, Device, State } from "react-native-ble-plx";
import { Buffer } from "buffer";

const SERVICE_UUID = "YOUR_SERVICE_UUID";
const CHARACTERISTIC_UUID = "YOUR_CHARACTERISTIC_UUID";

// ── SIMPLE EVENT EMITTER (NO DEPENDENCIES) ─────────────
class SimpleEmitter {
  private listeners: ((event: any) => void)[] = [];

  on(listener: (event: any) => void) {
    this.listeners.push(listener);
    return () => this.off(listener);
  }

  off(listener: (event: any) => void) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  emit(event: any) {
    this.listeners.forEach(l => l(event));
  }
}

// ── BLE MANAGER CLASS ───────────────────────────────────
class BLEManagerClass {
  private manager = new BleManager();
  private emitter = new SimpleEmitter();

  private currentDevice: Device | null = null;
  private lastDeviceId: string | null = null;

  private shouldReconnect = true;
  private isConnecting = false;

  private pollInterval: any = null;

  constructor() {
    // ✅ REAL BLE STATE STREAM (THIS FIXES YOUR ISSUE)
    this.manager.onStateChange((state) => {
      this.emit({ type: "ble_state", state });
    }, true);
  }

  // ── EVENTS ────────────────────────────────────────────
  on(listener: (event: any) => void) {
    return this.emitter.on(listener);
  }

  private emit(event: any) {
    this.emitter.emit(event);
  }

  // ── BLE STATE ────────────────────────────────────────
  async getBLEState() {
    return await this.manager.state();
  }

  // ── SCAN ──────────────────────────────────────────────
  async scan() {
    this.emit({ type: "status", status: "scanning" });

    this.manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        this.emit({ type: "error", message: error.message });
        return;
      }

      if (device?.name?.includes("BlowSafe")) {
        this.emit({ type: "scan_result", devices: [device] });
      }
    });

    setTimeout(() => this.stopScan(), 5000);
  }

  stopScan() {
    this.manager.stopDeviceScan();
  }

  // ── CONNECT ──────────────────────────────────────────
  async connect(device: Device) {
    if (this.isConnecting) return;

    this.isConnecting = true;
    this.emit({ type: "status", status: "connecting" });

    try {
      const d = await this.manager.connectToDevice(device.id, {
        autoConnect: true,
      });

      await d.discoverAllServicesAndCharacteristics();

      this.currentDevice = d;
      this.lastDeviceId = d.id;
      this.shouldReconnect = true;

      this.setupDisconnectListener(d);

      this.emit({ type: "status", status: "connected" });
    } catch (e: any) {
      this.emit({ type: "error", message: e.message });
    } finally {
      this.isConnecting = false;
    }
  }

  // ── AUTO CONNECT ─────────────────────────────────────
  async autoConnect() {
    if (!this.lastDeviceId) return;

    try {
      const d = await this.manager.connectToDevice(this.lastDeviceId, {
        autoConnect: true,
      });

      await d.discoverAllServicesAndCharacteristics();

      this.currentDevice = d;

      this.setupDisconnectListener(d);

      this.emit({ type: "status", status: "connected" });
    } catch {
      this.emit({ type: "status", status: "disconnected" });
    }
  }

  // ── DISCONNECT ───────────────────────────────────────
  async disconnect() {
    this.shouldReconnect = false;

    if (this.currentDevice) {
      await this.manager.cancelDeviceConnection(this.currentDevice.id);
    }

    this.currentDevice = null;
    this.lastDeviceId = null;

    this.stopPolling();

    this.emit({ type: "status", status: "disconnected" });
  }

  // ── FORCE DISCONNECT ─────────────────────────────────
  async forceDisconnect() {
    this.shouldReconnect = false;

    if (this.currentDevice) {
      await this.manager.cancelDeviceConnection(this.currentDevice.id);
    }

    this.currentDevice = null;

    this.stopPolling();

    this.emit({ type: "status", status: "disconnected" });
  }

  // ── DISCONNECT LISTENER ─────────────────────────────
  private setupDisconnectListener(device: Device) {
    device.onDisconnected(() => {
      this.emit({ type: "status", status: "disconnected" });

      this.stopPolling();

      if (this.shouldReconnect && this.lastDeviceId) {
        setTimeout(() => this.autoConnect(), 1500);
      }
    });
  }

  // ── READ DATA ───────────────────────────────────────
  async readData() {
    if (!this.currentDevice) return null;

    try {
      const char = await this.currentDevice.readCharacteristicForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID
      );

      const value = char?.value
        ? Buffer.from(char.value, "base64").toString("utf-8")
        : null;

      this.emit({ type: "data", value });

      return value;
    } catch (e: any) {
      this.emit({ type: "error", message: e.message });
      return null;
    }
  }

  // ── POLLING ──────────────────────────────────────────
  startPolling() {
    this.stopPolling();

    this.pollInterval = setInterval(() => {
      if (this.currentDevice) {
        this.readData();
      }
    }, 2000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // ── OPTIONAL ─────────────────────────────────────────
  refreshConnectionState() {
    if (this.currentDevice) {
      this.emit({ type: "status", status: "connected" });
    }
  }
}

export const bleManager = new BLEManagerClass();