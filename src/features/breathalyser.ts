// src/features/breathalyser.ts
import { BleManager, State, type Device, type Subscription } from "react-native-ble-plx";
import { Buffer } from "buffer";

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const TX_UUID      = "12345678-1234-1234-1234-123456789abd";
const RX_UUID      = "12345678-1234-1234-1234-123456789abe";
const SCAN_TIMEOUT = 10_000;
const CONN_TIMEOUT = 12_000;

// ── Types ─────────────────────────────────────────────────────────────────────

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
  | { type: "status";      status: DeviceStatus     }
  | { type: "result";      result: BACResult        }
  | { type: "battery";     level: number            }
  | { type: "recal"                                 }
  | { type: "stable"                                }
  | { type: "error";       message: string          }
  | { type: "scan_result"; devices: ScannedDevice[] }
  | { type: "ble_state";   state: State             };

type Listener = (event: BreathalyserEvent) => void;

// ── Manager ───────────────────────────────────────────────────────────────────

export class BreathalyserManager {
  // Single BleManager instance — never recreate, this is critical
  private ble          = new BleManager();
  private device:        Device | null       = null;
  private listeners:     Listener[]          = [];
  private rxBuffer       = "";
  private monitorSub:    Subscription | null = null;
  private bleStateSub:   Subscription | null = null;
  private foundDevices:  Map<string, ScannedDevice> = new Map();
  private bleState:      State  = State.Unknown;
  private isConnecting   = false; // guard against concurrent connect calls

  constructor() {
    // Monitor BLE adapter state — emit so UI can react immediately
    this.bleStateSub = this.ble.onStateChange((state) => {
      this.bleState = state;
      this.emit({ type: "ble_state", state });

      // BT turned off externally — clean up, no reconnect attempt
      if (state === State.PoweredOff && this.device) {
        this._cleanup();
        this.device = null;
        this.emit({ type: "status", status: "disconnected" });
      }
    }, true); // true = emit current state immediately on subscribe
  }

  on(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(event: BreathalyserEvent) {
    this.listeners.forEach(l => l(event));
  }

  getBLEState(): State { return this.bleState; }

  // ── Scan ──────────────────────────────────────────────────────────────────
  // Scans for SCAN_TIMEOUT ms, emits devices live as found.

  async scan(): Promise<ScannedDevice[]> {
    if (this.bleState !== State.PoweredOn) {
      this.emit({ type: "error", message: "Bluetooth is off. Please enable it first." });
      return [];
    }

    this.foundDevices.clear();
    this.emit({ type: "status", status: "scanning" });

    return new Promise(resolve => {
      this.ble.startDeviceScan(
        null,
        { allowDuplicates: false },
        (err, d) => {
          if (err) {
            this.emit({ type: "error", message: `Scan failed: ${err.message}` });
            this.emit({ type: "status", status: "disconnected" });
            resolve([]);
            return;
          }
          if (!d) return;
          const name = d.name ?? d.localName ?? "";
          if (!name) return;
          this.foundDevices.set(d.id, { id: d.id, name });
          this.emit({ type: "scan_result", devices: [...this.foundDevices.values()] });
        }
      );

      setTimeout(() => {
        this.ble.stopDeviceScan();
        const devices = [...this.foundDevices.values()];
        if (devices.length === 0) {
          this.emit({ type: "error", message: "No devices found. Ensure BlowSafe is on and nearby." });
        }
        this.emit({ type: "status", status: "disconnected" });
        resolve(devices);
      }, SCAN_TIMEOUT);
    });
  }

  stopScan(): void { this.ble.stopDeviceScan(); }

  // ── Connect ───────────────────────────────────────────────────────────────
  //
  // Research findings applied here:
  //
  // 1. Check isDeviceConnected() first — calling connectToDevice() on an
  //    already-connected device causes "Operation was cancelled" immediately.
  //    This is a known BLE PLX issue (#426, #1080).
  //
  // 2. cancelConnection() before reconnecting — clears any stale OS-level
  //    connection state that causes phantom "Operation was cancelled" errors.
  //
  // 3. No MTU negotiation during connect — R4 ArduinoBLE chokes on this.
  //    MTU stays at default (23 bytes), which is fine for our short strings.
  //
  // 4. Set up monitorCharacteristicForService BEFORE writing anything.
  //    Active monitoring subscription is what keeps the connection alive
  //    past the OS 30s idle timeout (confirmed issue #1219). No pings needed.
  //
  // 5. Wait 1000ms after discoverAllServicesAndCharacteristics before writing.
  //    R4's ESP32-S3 BLE stack needs time to complete the GATT exchange.
  //
  // 6. Use writeWithoutResponse for STATUS — fire-and-forget, never blocks.
  //    writeWithResponse only for SCAN — we need ACK for that critical command.
  //
  // 7. No auto-reconnect loops — they cause cascading cancellations.
  //    Device off = clean disconnect. Officer reconnects manually.

  async connect(device: ScannedDevice): Promise<void> {
    // Guard: prevent concurrent connect attempts
    if (this.isConnecting) {
      console.log("[BLE] Already connecting, ignoring duplicate request");
      return;
    }
    if (this.bleState !== State.PoweredOn) {
      throw new Error("Bluetooth is off. Please enable it first.");
    }

    this.isConnecting = true;
    this.ble.stopDeviceScan();
    this.emit({ type: "status", status: "connecting" });

    try {
      // Cancel any stale OS connection before attempting fresh connect.
      // This resolves "Operation was cancelled" on reconnect attempts.
      const alreadyConnected = await this.ble.isDeviceConnected(device.id).catch(() => false);
      if (alreadyConnected) {
        console.log("[BLE] Device already connected at OS level, cancelling first");
        await this.ble.cancelDeviceConnection(device.id).catch(() => {});
        await new Promise(r => setTimeout(r, 300));
      }

      // Connect — no autoConnect, no MTU request
      let timeoutId: ReturnType<typeof setTimeout>;
      const connPromise = this.ble.connectToDevice(device.id, { autoConnect: false });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Connection timed out. Ensure BlowSafe is on and nearby.")),
          CONN_TIMEOUT
        );
      });

      this.device = await Promise.race([connPromise, timeoutPromise]);
      clearTimeout(timeoutId!);

      // Discover services and characteristics — required step before any access
      await this.device.discoverAllServicesAndCharacteristics();

      // Set up monitor FIRST — this keeps connection alive past OS 30s timeout.
      // An active GATT subscription prevents the OS from timing out the link.
      // Without this, the device disconnects after ~30s of no writes.
      this._setupMonitor();

      // Let R4 BLE stack settle after GATT discovery before first write
      await new Promise(r => setTimeout(r, 1000));

      // Request status — writeWithoutResponse so we never block on ACK
      await this._writeNoResponse("STATUS");

      // Register disconnect handler — no auto-reconnect, just clean state
      this.device.onDisconnected((_err, _d) => {
        console.log("[BLE] Device disconnected");
        this._cleanup();
        this.device      = null;
        this.isConnecting = false;
        this.emit({ type: "status", status: "disconnected" });
      });

      this.emit({ type: "status", status: "connected" });
      console.log("[BLE] Connected to", device.name);

    } catch (err: any) {
      this._cleanup();
      this.device      = null;
      this.isConnecting = false;

      // Map known BLE PLX error codes to friendly messages
      const msg = this._friendlyError(err);
      this.emit({ type: "error",  message: msg });
      this.emit({ type: "status", status: "disconnected" });
      throw new Error(msg);
    }

    this.isConnecting = false;
  }

  // ── Monitor ───────────────────────────────────────────────────────────────
  // Active subscription = connection stays alive indefinitely.
  // Incoming data is base64 per react-native-ble-plx spec.
  // Buffers partial lines and splits on \n (Arduino appends \n to every msg).

  private _setupMonitor(): void {
    if (!this.device) return;

    this.monitorSub = this.device.monitorCharacteristicForService(
      SERVICE_UUID,
      TX_UUID,
      (err, char) => {
        if (err) {
          // Suppress expected errors on intentional disconnect
          const msg = err.message ?? "";
          if (
            msg.includes("cancelled") ||
            msg.includes("disconnected") ||
            msg.includes("destroyed")
          ) return;
          console.log("[BLE] Monitor error:", msg);
          return;
        }
        if (!char?.value) return;

        const text = Buffer.from(char.value, "base64").toString("utf-8");
        this.rxBuffer += text;
        const lines = this.rxBuffer.split("\n");
        this.rxBuffer = lines.pop() ?? "";
        lines.forEach(l => { if (l.trim()) this._parseLine(l.trim()); });
      }
    );
  }

  // ── Parse lines from Arduino ───────────────────────────────────────────────

  private _parseLine(line: string): void {
    console.log("[BLE RX]", line);

    // STATE:READY:85 / STATE:WARMUP:85 / STATE:FAIL:85 etc.
    if (line.startsWith("STATE:")) {
      const parts     = line.split(":");
      const state     = parts[1]?.trim() ?? "";
      const battLevel = parseInt(parts[2] ?? "0", 10);
      if (!isNaN(battLevel) && battLevel > 0) this.emit({ type: "battery", level: battLevel });
      switch (state) {
        case "READY":    this.emit({ type: "status", status: "ready" });         break;
        case "WARMUP":   this.emit({ type: "status", status: "warmup" });        break;
        case "SCANNING": this.emit({ type: "status", status: "scanning_bac" }); break;
        case "FAIL":     this.emit({ type: "status", status: "error" });         break;
        case "RECAL":
          this.emit({ type: "status", status: "recalibrating" });
          this.emit({ type: "recal" });
          break;
      }
      return;
    }

    // PONG:85
    if (line.startsWith("PONG:")) {
      const batt = parseInt(line.slice(5), 10);
      if (!isNaN(batt)) this.emit({ type: "battery", level: batt });
      return;
    }

    // Bare state strings
    switch (line) {
      case "READY":    this.emit({ type: "status", status: "ready" });         return;
      case "WARMUP":   this.emit({ type: "status", status: "warmup" });        return;
      case "SCANNING": this.emit({ type: "status", status: "scanning_bac" }); return;
      case "RECAL":
        this.emit({ type: "status", status: "recalibrating" });
        this.emit({ type: "recal" });
        return;
      case "STABLE":
        this.emit({ type: "stable" });
        this.emit({ type: "status", status: "ready" });
        return;
    }

    // BAC:0.042:PASS / BAC:0.095:FAIL
    if (line.startsWith("BAC:")) {
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
      return;
    }

    // ERR:WARMUP / ERR:RECAL / ERR:SENSOR
    if (line.startsWith("ERR:")) {
      const msgs: Record<string, string> = {
        WARMUP: "Device still warming up — wait 60s.",
        RECAL:  "Device recalibrating — please wait.",
        SENSOR: "Sensor fault — check hardware.",
      };
      this.emit({ type: "error", message: msgs[line.slice(4)] ?? `Device error: ${line.slice(4)}` });
    }
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  // _writeNoResponse: STATUS, PING — fire and forget, never causes cancellation
  // _writeWithResponse: SCAN only — we need confirmed delivery

  private async _writeNoResponse(cmd: string): Promise<void> {
    if (!this.device) return;
    try {
      const b64 = Buffer.from(`${cmd}\n`, "utf-8").toString("base64");
      await this.device.writeCharacteristicWithoutResponseForService(
        SERVICE_UUID, RX_UUID, b64
      );
    } catch (err: any) {
      console.log("[BLE] NoResp write error:", cmd, err?.message);
    }
  }

  private async _writeWithResponse(cmd: string): Promise<void> {
    if (!this.device) throw new Error("No device connected");
    const b64 = Buffer.from(`${cmd}\n`, "utf-8").toString("base64");
    await this.device.writeCharacteristicWithResponseForService(
      SERVICE_UUID, RX_UUID, b64
    );
  }

  // ── Public commands ───────────────────────────────────────────────────────

  // SCAN is critical — use withResponse so we know Arduino received it
  async requestScan(): Promise<void> {
    await this._writeWithResponse("SCAN");
  }

  // STATUS and PING are informational — withoutResponse only
  async ping():          Promise<void> { await this._writeNoResponse("PING");   }
  async requestStatus(): Promise<void> { await this._writeNoResponse("STATUS"); }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this._cleanup();
    try { await this.device?.cancelConnection(); } catch {}
    this.device      = null;
    this.isConnecting = false;
    this.emit({ type: "status", status: "disconnected" });
  }

  private _cleanup(): void {
    try { this.monitorSub?.remove(); } catch {}
    this.monitorSub = null;
    this.rxBuffer   = "";
  }

  // ── Error mapping ─────────────────────────────────────────────────────────
  // Map BLE PLX numeric error codes to human-readable messages

  private _friendlyError(err: any): string {
    const code = err?.errorCode ?? err?.code;
    switch (code) {
      case 2:   return "Connection was cancelled. Please try again.";
      case 3:   return "Connection timed out. Ensure BlowSafe is on and nearby.";
      case 200: return "Connection failed. Move closer and try again.";
      case 203: return "Device already connected.";
      case 205: return "Device not connected.";
      default:  return err?.message ?? "Connection failed. Try again.";
    }
  }

  isConnected():            boolean { return this.device !== null; }
  getConnectedDeviceName(): string  { return this.device?.name ?? "BlowSafe"; }
}

// Singleton — one instance for the entire app lifetime
export const breathalyser = new BreathalyserManager();