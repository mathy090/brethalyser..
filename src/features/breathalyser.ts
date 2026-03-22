/**
 * src/features/breathalyser.ts
 *
 * BLE via react-native-ble-plx.
 *
 * Correct BLE flow (from documentation):
 *   1. Scan for devices by name "BlowSafe"
 *   2. Connect directly from app — no Android Settings pairing needed
 *   3. Discover services + characteristics
 *   4. Monitor TX characteristic (base64 decoded)
 *   5. Write to RX characteristic (base64 encoded)
 *   6. Auto-reconnect on disconnect
 */

import { BleManager, type Device, type Subscription } from "react-native-ble-plx";
import { Buffer } from "buffer";

const DEVICE_NAME  = "BlowSafe";
const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const TX_UUID      = "12345678-1234-1234-1234-123456789abd";
const RX_UUID      = "12345678-1234-1234-1234-123456789abe";
const SCAN_TIMEOUT = 10_000;
const CONN_TIMEOUT = 15_000;
const PING_INTERVAL = 15_000;

export type DeviceStatus =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected"
  | "warmup"
  | "ready"
  | "scanning_bac"
  | "recalibrating"
  | "error";

export interface BACResult {
  bac:        number;
  bacPercent: string;
  bacMg:      string;
  status:     "PASS" | "FAIL";
  legalLimit: number;
  overLimit:  boolean;
  timestamp:  number;
}

export interface ScannedDevice {
  id:   string;
  name: string;
}

export type BreathalyserEvent =
  | { type: "status";          status: DeviceStatus }
  | { type: "result";          result: BACResult }
  | { type: "battery";         level: number }
  | { type: "recal" }
  | { type: "stable" }
  | { type: "error";           message: string }
  | { type: "scan_result";     devices: ScannedDevice[] };

type Listener = (event: BreathalyserEvent) => void;

export class BreathalyserManager {
  private ble             = new BleManager();
  private device:           Device | null   = null;
  private listeners:        Listener[]      = [];
  private rxBuffer          = "";
  private monitorSub:       Subscription | null = null;
  private reconnectTimer:   ReturnType<typeof setTimeout>  | null = null;
  private pingTimer:        ReturnType<typeof setInterval> | null = null;
  private lastDevice:       ScannedDevice | null = null;
  private shouldReconnect   = false;
  private foundDevices:     Map<string, ScannedDevice> = new Map();

  on(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(event: BreathalyserEvent) {
    this.listeners.forEach(l => l(event));
  }

  // ── Scan for BlowSafe ──────────────────────────────────────────────────────
  // Scans for 10 seconds, returns all devices named BlowSafe
  async scan(): Promise<ScannedDevice[]> {
    this.foundDevices.clear();
    this.emit({ type: "status", status: "scanning" });

    return new Promise(resolve => {
      this.ble.startDeviceScan(
        null,                        // no service UUID filter — scan all
        { allowDuplicates: false },
        (err, d) => {
          if (err) {
            console.log("[BLE] Scan error:", err.message);
            this.emit({ type: "error", message: `Scan error: ${err.message}` });
            this.emit({ type: "status", status: "disconnected" });
            resolve([]);
            return;
          }
          if (!d) return;

          const name = d.name ?? d.localName ?? "";
          // Show all named devices, highlight BlowSafe
          if (!name) return;

          console.log("[BLE] Found:", name, d.id);
          this.foundDevices.set(d.id, { id: d.id, name });
          this.emit({ type: "scan_result", devices: [...this.foundDevices.values()] });
        }
      );

      setTimeout(() => {
        this.ble.stopDeviceScan();
        const devices = [...this.foundDevices.values()];
        console.log("[BLE] Scan done. Found:", devices.length);

        if (devices.length === 0) {
          this.emit({
            type:    "error",
            message: "No devices found. Ensure BlowSafe is powered on and nearby.",
          });
        }
        this.emit({ type: "status", status: "disconnected" });
        resolve(devices);
      }, SCAN_TIMEOUT);
    });
  }

  stopScan(): void {
    this.ble.stopDeviceScan();
  }

  // ── Connect directly from app ──────────────────────────────────────────────
  async connect(device: ScannedDevice): Promise<void> {
    this.ble.stopDeviceScan();
    this.shouldReconnect = true;
    this.lastDevice      = device;
    this.emit({ type: "status", status: "connecting" });

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Connection timed out — ensure BlowSafe is powered on and nearby.")),
        CONN_TIMEOUT
      );
    });

    try {
      // Connect to device — discovered during scan
      this.device = await Promise.race([
        this.ble.connectToDevice(device.id, {
          requestMTU:           128,
          autoConnect:          false,  // we handle reconnect ourselves
        }),
        timeout,
      ]);
      clearTimeout(timeoutId!);

      // Must discover all services and characteristics before reading/writing
      await this.device.discoverAllServicesAndCharacteristics();
      this.emit({ type: "status", status: "connected" });
      console.log("[BLE] Connected to", device.name);

      // Sync state from device immediately
      setTimeout(() => {
        this.write("STATUS").catch(() => {});
        this.write("PING").catch(() => {});
      }, 500);

      // Keep-alive ping every 15s
      this.pingTimer = setInterval(() => {
        if (this.device) this.write("PING").catch(() => {});
      }, PING_INTERVAL);

      // Monitor TX characteristic — base64 decoded per docs
      this.monitorSub = this.device.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_UUID,
        (err, char) => {
          if (err) { console.log("[BLE] Monitor err:", err.message); return; }
          if (!char?.value) return;
          // Decode base64 per react-native-ble-plx docs
          const text = Buffer.from(char.value, "base64").toString("utf-8");
          this.rxBuffer += text;
          const lines = this.rxBuffer.split("\n");
          this.rxBuffer = lines.pop() ?? "";
          lines.forEach(l => this.parseLine(l.trim()));
        }
      );

      // Handle disconnect — re-advertise triggers reconnect
      this.device.onDisconnected(() => {
        console.log("[BLE] Disconnected");
        this.cleanupSubs();
        this.device = null;
        this.emit({ type: "status", status: "disconnected" });
        if (this.shouldReconnect && this.lastDevice) {
          this.scheduleReconnect(3000);
        }
      });

    } catch (err: any) {
      clearTimeout(timeoutId!);
      this.device = null;
      this.emit({ type: "error",  message: err.message ?? "Connection failed" });
      this.emit({ type: "status", status: "disconnected" });
      if (this.shouldReconnect && this.lastDevice) {
        this.scheduleReconnect(5000);
      }
      throw err;
    }
  }

  // ── Auto reconnect ─────────────────────────────────────────────────────────
  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      if (!this.shouldReconnect || !this.lastDevice) return;
      console.log("[BLE] Reconnecting to", this.lastDevice.name);

      // Re-scan briefly to find device again
      this.emit({ type: "status", status: "scanning" });
      return new Promise<void>(resolve => {
        let found = false;
        this.ble.startDeviceScan(null, { allowDuplicates: false }, async (err, d) => {
          if (err || !d) return;
          const name = d.name ?? d.localName ?? "";
          if (name === DEVICE_NAME && d.id === this.lastDevice?.id) {
            found = true;
            this.ble.stopDeviceScan();
            try {
              await this.connect({ id: d.id, name });
            } catch { this.scheduleReconnect(5000); }
            resolve();
          }
        });
        setTimeout(() => {
          if (!found) {
            this.ble.stopDeviceScan();
            this.emit({ type: "status", status: "disconnected" });
            this.scheduleReconnect(5000);
            resolve();
          }
        }, 8000);
      });
    }, delayMs);
  }

  // ── Parse incoming messages ────────────────────────────────────────────────
  private parseLine(line: string): void {
    if (!line) return;
    console.log("[BLE RX]", line);

    if (line.startsWith("STATE:")) {
      const [, state, batt] = line.split(":");
      const battLevel = parseInt(batt ?? "0", 10);
      if (!isNaN(battLevel)) this.emit({ type: "battery", level: battLevel });
      switch (state?.trim()) {
        case "READY":    this.emit({ type: "status", status: "ready" });         break;
        case "WARMUP":   this.emit({ type: "status", status: "warmup" });        break;
        case "SCANNING": this.emit({ type: "status", status: "scanning_bac" }); break;
        case "RECAL":
          this.emit({ type: "status", status: "recalibrating" });
          this.emit({ type: "recal" });
          break;
      }
      return;
    }

    if (line.startsWith("PONG:")) {
      const batt = parseInt(line.slice(5), 10);
      if (!isNaN(batt)) this.emit({ type: "battery", level: batt });
      return;
    }

    switch (true) {
      case line === "READY":
        this.emit({ type: "status", status: "ready" });
        break;
      case line === "WARMUP":
        this.emit({ type: "status", status: "warmup" });
        break;
      case line === "SCANNING":
        this.emit({ type: "status", status: "scanning_bac" });
        break;
      case line === "RECAL":
        this.emit({ type: "status", status: "recalibrating" });
        this.emit({ type: "recal" });
        break;
      case line === "STABLE":
        this.emit({ type: "stable" });
        this.emit({ type: "status", status: "ready" });
        break;
      case line.startsWith("BAC:"): {
        const parts  = line.split(":");
        const bac    = parseFloat(parts[1] ?? "0");
        const isFail = parts[2]?.trim() === "FAIL";
        const result: BACResult = {
          bac,
          bacPercent: `${bac.toFixed(3)}%`,
          bacMg:      `${Math.round(bac * 1000)} mg/100ml`,
          status:     isFail ? "FAIL" : "PASS",
          legalLimit: 0.08,
          overLimit:  isFail,
          timestamp:  Date.now(),
        };
        this.emit({ type: "result", result });
        this.emit({ type: "status", status: isFail ? "error" : "ready" });
        break;
      }
      case line.startsWith("ERR:"): {
        const msgs: Record<string, string> = {
          WARMUP: "Device still warming up — wait 60s.",
          RECAL:  "Device recalibrating — please wait.",
          SENSOR: "Sensor fault — check hardware.",
        };
        this.emit({ type: "error", message: msgs[line.slice(4)] ?? `Device error: ${line.slice(4)}` });
        break;
      }
    }
  }

  // ── Commands ───────────────────────────────────────────────────────────────
  async requestScan(): Promise<void> { await this.write("SCAN"); }

  private async write(cmd: string): Promise<void> {
    if (!this.device) throw new Error("No device connected");
    // Encode to base64 per react-native-ble-plx docs
    const encoded = Buffer.from(`${cmd}\n`, "utf-8").toString("base64");
    await this.device.writeCharacteristicWithResponseForService(
      SERVICE_UUID, RX_UUID, encoded
    );
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.lastDevice      = null;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer);  this.reconnectTimer = null; }
    this.cleanupSubs();
    try { await this.device?.cancelConnection(); } catch {}
    this.device = null;
    this.emit({ type: "status", status: "disconnected" });
  }

  private cleanupSubs(): void {
    if (this.pingTimer)  { clearInterval(this.pingTimer);  this.pingTimer  = null; }
    try { this.monitorSub?.remove(); } catch {}
    this.monitorSub = null;
    this.rxBuffer   = "";
  }

  isConnected():            boolean         { return this.device !== null; }
  getConnectedDeviceName(): string          { return this.device?.name ?? DEVICE_NAME; }
  getLastDevice():          ScannedDevice | null { return this.lastDevice; }
}

export const breathalyser = new BreathalyserManager();