import { BleManager, State, type Device, type Subscription } from "react-native-ble-plx";
import { Buffer } from "buffer";

// ── Constants ──────────────────────────────────────────────────────────────────
const SERVICE_UUID  = "12345678-1234-1234-1234-123456789abc";
const TX_UUID       = "12345678-1234-1234-1234-123456789abd";
const RX_UUID       = "12345678-1234-1234-1234-123456789abe";
const SCAN_TIMEOUT  = 10_000;
const CONN_TIMEOUT  = 12_000;
const MAX_RETRIES   = 2;          // automatic reconnect attempts on unexpected drop
const RETRY_DELAY   = 1_500;      // ms between retry attempts

// ── Types ──────────────────────────────────────────────────────────────────────
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
  rssi: number;   // signal strength — lets UI sort by proximity
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

// ── Write queue ────────────────────────────────────────────────────────────────
// Serialises all GATT writes. Concurrent writes to the same characteristic
// cause "Operation was cancelled" on R4 ArduinoBLE (GATT doesn't queue writes
// server-side). Every write goes through enqueue() — never called directly.
interface WriteJob {
  cmd:          string;
  withResponse: boolean;
  resolve:      () => void;
  reject:       (err: Error) => void;
}

class WriteQueue {
  private queue: WriteJob[] = [];
  private running           = false;

  enqueue(cmd: string, withResponse: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, withResponse, resolve, reject });
      this.flush();
    });
  }

  private async flush(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    this.running    = true;
    const job       = this.queue.shift()!;
    try {
      await this._exec(job);
      job.resolve();
    } catch (e: any) {
      job.reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.running = false;
      this.flush();
    }
  }

  // _exec is set by BreathalyserManager so it has access to the device
  _exec: (job: WriteJob) => Promise<void> = async () => {};

  drain(): void {
    for (const j of this.queue) j.reject(new Error("Queue drained — device disconnected"));
    this.queue   = [];
    this.running = false;
  }
}

// ── Manager ────────────────────────────────────────────────────────────────────
export class BreathalyserManager {
  private ble            = new BleManager();
  private device:          Device | null          = null;
  private listeners:       Listener[]             = [];
  private rxBuffer         = "";
  private monitorSub:      Subscription | null    = null;
  private bleStateSub:     Subscription | null    = null;
  private foundDevices:    Map<string, ScannedDevice> = new Map();
  private bleState:        State                  = State.Unknown;

  // Concurrency guards
  private isConnecting     = false;
  private isDisconnecting  = false;
  private retryCount       = 0;
  private retryTimer:      ReturnType<typeof setTimeout> | null = null;
  private lastConnectedDevice: ScannedDevice | null = null;

  private wq = new WriteQueue();

  constructor() {
    // Wire the write queue executor to the live device
    this.wq._exec = async (job: WriteJob) => {
      if (!this.device) throw new Error("No device connected");
      const b64 = Buffer.from(`${job.cmd}\n`, "utf-8").toString("base64");
      if (job.withResponse) {
        await this.device.writeCharacteristicWithResponseForService(SERVICE_UUID, RX_UUID, b64);
      } else {
        await this.device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, RX_UUID, b64);
      }
    };

    this.bleStateSub = this.ble.onStateChange((state) => {
      this.bleState = state;
      this.emit({ type: "ble_state", state });

      if (state === State.PoweredOff && this.device) {
        this._cleanupDevice("BLE adapter turned off");
      }
    }, true);
  }

  // ── Public event bus ─────────────────────────────────────────────────────────
  on(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(event: BreathalyserEvent): void {
    this.listeners.forEach(l => {
      try { l(event); } catch { /* never let a listener crash the manager */ }
    });
  }

  getBLEState(): State { return this.bleState; }
  isConnected():  boolean { return this.device !== null; }
  getConnectedDeviceName(): string { return this.device?.name ?? this.lastConnectedDevice?.name ?? "BlowSafe"; }

  // ── Scan ─────────────────────────────────────────────────────────────────────
  // Returns discovered devices sorted by RSSI (strongest signal first).
  // Emits live scan_result updates as devices appear.
  async scan(): Promise<ScannedDevice[]> {
    if (this.bleState !== State.PoweredOn) {
      this.emit({ type: "error", message: "Bluetooth is off — please enable it first." });
      return [];
    }

    this.foundDevices.clear();
    this.emit({ type: "status", status: "scanning" });

    return new Promise<ScannedDevice[]>((resolve) => {
      const timer = setTimeout(() => {
        this.ble.stopDeviceScan();
        const devices = this._sortedDevices();
        if (devices.length === 0) {
          this.emit({ type: "error", message: "No devices found. Ensure BlowSafe is on and nearby." });
        }
        this.emit({ type: "status", status: "disconnected" });
        resolve(devices);
      }, SCAN_TIMEOUT);

      this.ble.startDeviceScan(
        null,
        { allowDuplicates: false },
        (err, d) => {
          if (err) {
            clearTimeout(timer);
            this.ble.stopDeviceScan();
            this.emit({ type: "error", message: `Scan failed: ${err.message}` });
            this.emit({ type: "status", status: "disconnected" });
            resolve([]);
            return;
          }
          if (!d) return;
          const name = (d.name ?? d.localName ?? "").trim();
          if (!name) return;
          this.foundDevices.set(d.id, { id: d.id, name, rssi: d.rssi ?? -100 });
          this.emit({ type: "scan_result", devices: this._sortedDevices() });
        }
      );
    });
  }

  stopScan(): void { this.ble.stopDeviceScan(); }

  private _sortedDevices(): ScannedDevice[] {
    return [...this.foundDevices.values()].sort((a, b) => b.rssi - a.rssi);
  }

  // ── Connect ───────────────────────────────────────────────────────────────────
  // Full connection sequence:
  //   1. Guard concurrent connect attempts
  //   2. Cancel any stale OS-level connection
  //   3. Race connectToDevice() against a timeout
  //   4. Discover services
  //   5. Set up monitor subscription BEFORE any write
  //   6. Wait 1 000 ms for R4 GATT to settle
  //   7. Request STATUS via write queue
  //   8. Register disconnect handler with optional auto-retry
  async connect(device: ScannedDevice): Promise<void> {
    if (this.isConnecting) return;
    if (this.isDisconnecting) {
      throw new Error("Disconnecting — wait before reconnecting.");
    }
    if (this.bleState !== State.PoweredOn) {
      throw new Error("Bluetooth is off — please enable it first.");
    }

    this._clearRetryTimer();
    this.isConnecting = true;
    this.ble.stopDeviceScan();
    this.emit({ type: "status", status: "connecting" });

    try {
      // ── Step 1: cancel stale OS connection ────────────────────────────────
      const alreadyConn = await this.ble.isDeviceConnected(device.id).catch(() => false);
      if (alreadyConn) {
        await this.ble.cancelDeviceConnection(device.id).catch(() => {});
        await _sleep(400);
      }

      // ── Step 2: connect with timeout race ────────────────────────────────
      this.device = await _withTimeout(
        this.ble.connectToDevice(device.id, { autoConnect: false }),
        CONN_TIMEOUT,
        `Connection timed out — ensure BlowSafe is on and nearby.`
      );

      // ── Step 3: discover services ────────────────────────────────────────
      await this.device.discoverAllServicesAndCharacteristics();

      // ── Step 4: monitor BEFORE any write ────────────────────────────────
      this._setupMonitor();

      // ── Step 5: settle time for R4 BLE stack ────────────────────────────
      await _sleep(1_000);

      // ── Step 6: request device status ────────────────────────────────────
      await this.wq.enqueue("STATUS", false);

      // ── Step 7: register disconnect handler ──────────────────────────────
      this.device.onDisconnected((_err, _d) => {
        const wasExpected = this.isDisconnecting;
        this._cleanupDevice(wasExpected ? null : "Device disconnected unexpectedly.");
        if (!wasExpected && this.retryCount < MAX_RETRIES) {
          this._scheduleRetry(device);
        }
      });

      this.lastConnectedDevice = device;
      this.retryCount          = 0;
      this.emit({ type: "status", status: "connected" });

    } catch (err: any) {
      this._cleanupDevice(null);
      const msg = _friendlyError(err);
      this.emit({ type: "error",  message: msg });
      this.emit({ type: "status", status: "disconnected" });
      throw new Error(msg);
    } finally {
      this.isConnecting = false;
    }
  }

  // ── Auto-retry after unexpected drop ─────────────────────────────────────────
  private _scheduleRetry(device: ScannedDevice): void {
    this._clearRetryTimer();
    this.retryCount++;
    this.retryTimer = setTimeout(async () => {
      if (this.isConnecting || this.isDisconnecting) return;
      try {
        await this.connect(device);
      } catch {
        if (this.retryCount >= MAX_RETRIES) {
          this.emit({ type: "error", message: "Could not reconnect after multiple attempts. Please reconnect manually." });
          this.retryCount = 0;
        }
      }
    }, RETRY_DELAY * this.retryCount); // simple linear backoff
  }

  private _clearRetryTimer(): void {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  // ── Monitor ───────────────────────────────────────────────────────────────────
  // Keeps the OS GATT connection alive — an active subscription prevents the
  // 30-second idle timeout from closing the link without a write.
  private _setupMonitor(): void {
    if (!this.device) return;
    this.monitorSub?.remove();

    this.monitorSub = this.device.monitorCharacteristicForService(
      SERVICE_UUID,
      TX_UUID,
      (err, char) => {
        if (err) {
          const msg = err.message ?? "";
          if (/cancelled|disconnected|destroyed/i.test(msg)) return;
          // Non-fatal monitor error — log, don't crash connection
          return;
        }
        if (!char?.value) return;

        let text: string;
        try {
          text = Buffer.from(char.value, "base64").toString("utf-8");
        } catch {
          return; // malformed base64 from a noisy BLE environment — skip frame
        }

        this.rxBuffer += text;
        const lines    = this.rxBuffer.split("\n");
        this.rxBuffer  = lines.pop() ?? "";
        lines.forEach(l => { const t = l.trim(); if (t) this._parseLine(t); });
      }
    );
  }

  // ── Line parser ───────────────────────────────────────────────────────────────
  private _parseLine(line: string): void {
    // STATE:<status>:<battery>
    if (line.startsWith("STATE:")) {
      const [, state = "", battRaw = ""] = line.split(":");
      const batt = _safeInt(battRaw);
      if (batt > 0) this.emit({ type: "battery", level: batt });

      const statusMap: Record<string, DeviceStatus> = {
        READY:    "ready",
        WARMUP:   "warmup",
        SCANNING: "scanning_bac",
        FAIL:     "error",
        RECAL:    "recalibrating",
      };
      const mapped = statusMap[state.trim()];
      if (mapped) {
        this.emit({ type: "status", status: mapped });
        if (state.trim() === "RECAL") this.emit({ type: "recal" });
      }
      return;
    }

    // PONG:<battery>
    if (line.startsWith("PONG:")) {
      const batt = _safeInt(line.slice(5));
      if (batt > 0) this.emit({ type: "battery", level: batt });
      return;
    }

    // BAC:<value>:<PASS|FAIL>
    if (line.startsWith("BAC:")) {
      const parts  = line.split(":");
      const bac    = _safeFloat(parts[1] ?? "");
      const isFail = (parts[2] ?? "").trim().toUpperCase() === "FAIL";

      if (isNaN(bac)) {
        this.emit({ type: "error", message: "Malformed BAC reading — please retry." });
        return;
      }

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
      this.emit({ type: "status", status: "ready" });
      return;
    }

    // ERR:<code>
    if (line.startsWith("ERR:")) {
      const errMessages: Record<string, string> = {
        WARMUP: "Device still warming up — wait 60 s before scanning.",
        RECAL:  "Device is recalibrating — please wait.",
        SENSOR: "Sensor fault detected — check hardware.",
      };
      const code = line.slice(4).trim();
      this.emit({ type: "error", message: errMessages[code] ?? `Device error: ${code}` });
      return;
    }

    // Bare state tokens
    const bareMap: Record<string, DeviceStatus> = {
      READY:    "ready",
      WARMUP:   "warmup",
      SCANNING: "scanning_bac",
      RECAL:    "recalibrating",
      STABLE:   "ready",
    };
    const bareStatus = bareMap[line];
    if (bareStatus) {
      this.emit({ type: "status", status: bareStatus });
      if (line === "RECAL")  this.emit({ type: "recal" });
      if (line === "STABLE") this.emit({ type: "stable" });
    }
  }

  // ── Public commands ────────────────────────────────────────────────────────────
  // SCAN uses withResponse — we need confirmed delivery for this critical command.
  // STATUS and PING are informational — fire-and-forget.
  async requestScan():   Promise<void> { await this.wq.enqueue("SCAN",   true);  }
  async requestStatus(): Promise<void> { await this.wq.enqueue("STATUS", false); }
  async ping():          Promise<void> { await this.wq.enqueue("PING",   false); }

  // ── Disconnect ────────────────────────────────────────────────────────────────
  async disconnect(): Promise<void> {
    if (this.isDisconnecting) return;
    this.isDisconnecting = true;
    this._clearRetryTimer();
    this.retryCount = 0;
    this.wq.drain();
    this._teardownMonitor();

    try { await this.device?.cancelConnection(); } catch { /* expected */ }

    this.device      = null;
    this.rxBuffer    = "";
    this.isDisconnecting = false;
    this.emit({ type: "status", status: "disconnected" });
  }

  // ── Internal cleanup ──────────────────────────────────────────────────────────
  // Used on unexpected drops — does NOT cancel the connection (already gone).
  private _cleanupDevice(errorMessage: string | null): void {
    this.wq.drain();
    this._teardownMonitor();
    this.device   = null;
    this.rxBuffer = "";
    if (errorMessage) this.emit({ type: "error",  message: errorMessage });
    this.emit({ type: "status", status: "disconnected" });
  }

  private _teardownMonitor(): void {
    try { this.monitorSub?.remove(); } catch { /* ignore */ }
    this.monitorSub = null;
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function _withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}

function _safeInt(raw: string): number {
  const n = parseInt(raw.trim(), 10);
  return isNaN(n) ? -1 : n;
}

function _safeFloat(raw: string): number {
  return parseFloat(raw.trim());
}

function _friendlyError(err: any): string {
  const code = err?.errorCode ?? err?.code;
  switch (code) {
    case 2:   return "Connection was cancelled — please try again.";
    case 3:   return "Connection timed out — ensure BlowSafe is on and nearby.";
    case 200: return "Connection failed — move closer and try again.";
    case 203: return "Device already connected.";
    case 205: return "Device not connected.";
    default:  return err?.message ?? "Connection failed — please try again.";
  }
}

// Singleton
export const breathalyser = new BreathalyserManager();