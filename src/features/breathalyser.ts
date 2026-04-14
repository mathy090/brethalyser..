import { BleManager, State, type Device, type Subscription } from "react-native-ble-plx";
import { Buffer } from "buffer";

const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const TX_UUID      = "12345678-1234-1234-1234-123456789abd";
const RX_UUID      = "12345678-1234-1234-1234-123456789abe";
const SCAN_TIMEOUT  = 10_000;
const CONN_TIMEOUT  = 12_000;
const MAX_RETRIES   = 3;
const RETRY_DELAY   = 2_000;
const HEARTBEAT_INTERVAL = 15_000;
const HEARTBEAT_TIMEOUT  = 8_000;

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
  rssi: number;
}

export type BreathalyserEvent =
  | { type: "status";      status: DeviceStatus }
  | { type: "result";      result: BACResult    }
  | { type: "battery";     level: number        }
  | { type: "recal"                             }
  | { type: "stable"                            }
  | { type: "error";       message: string      }
  | { type: "scan_result"; devices: ScannedDevice[] }
  | { type: "ble_state";   state: State         }
  | { type: "debug";       message: string      };

type Listener = (event: BreathalyserEvent) => void;

interface WriteJob {
  cmd:          string;
  withResponse: boolean;
  resolve:      () => void;
  reject:       (err: Error) => void;
}

class WriteQueue {
  private queue:   WriteJob[] = [];
  private running              = false;

  _exec: (job: WriteJob) => Promise<void> = async () => {};

  enqueue(cmd: string, withResponse: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, withResponse, resolve, reject });
      this.flush();
    });
  }

  private async flush(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    this.running  = true;
    const job     = this.queue.shift()!;
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

  drain(): void {
    for (const j of this.queue) j.reject(new Error("Queue drained"));
    this.queue   = [];
    this.running = false;
  }

  get size(): number { return this.queue.length; }
}

export class BreathalyserManager {
  private ble            = new BleManager();
  private device:          Device | null       = null;
  private listeners:       Listener[]          = [];
  private rxBuffer         = "";
  private monitorSub:      Subscription | null = null;
  private bleStateSub:     Subscription | null = null;
  private foundDevices     = new Map<string, ScannedDevice>();
  private bleState:        State               = State.Unknown;

  // Lifecycle guards — these are the single source of truth for connection state
  private _isConnecting    = false;
  private _isDisconnecting = false;
  private _intentionalDisconnect = false;

  // Retry state
  private retryCount  = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConnectedDevice: ScannedDevice | null = null;

  // Heartbeat — detects silent drops (device powered off mid-session)
  private heartbeatTimer:  ReturnType<typeof setInterval> | null = null;
  private pongTimer:       ReturnType<typeof setTimeout>  | null = null;
  private lastPongAt       = 0;

  // Current status — single source of truth, never inferred from multiple flags
  private _status: DeviceStatus = "disconnected";

  private wq = new WriteQueue();

  constructor() {
    this.wq._exec = async (job: WriteJob) => {
      if (!this.device) throw new Error("No device connected");
      const b64 = Buffer.from(`${job.cmd}\n`, "utf-8").toString("base64");
      if (job.withResponse) {
        await this.device.writeCharacteristicWithResponseForService(
          SERVICE_UUID, RX_UUID, b64
        );
      } else {
        await this.device.writeCharacteristicWithoutResponseForService(
          SERVICE_UUID, RX_UUID, b64
        );
      }
    };

    this.bleStateSub = this.ble.onStateChange((state) => {
      this.bleState = state;
      this.emit({ type: "ble_state", state });
      this.emit({ type: "debug", message: `BLE adapter state: ${state}` });

      if (state === State.PoweredOff && this.device) {
        this._cleanupDevice("Bluetooth was turned off.");
      }
    }, true);
  }

  // ── Event bus ────────────────────────────────────────────────────────────────
  on(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(event: BreathalyserEvent): void {
    // Keep internal status in sync from a single place
    if (event.type === "status") {
      this._status = event.status;
    }
    this.listeners.forEach(l => {
      try { l(event); } catch { /* never crash the manager */ }
    });
  }

  // ── Public getters ───────────────────────────────────────────────────────────
  getBLEState():            State        { return this.bleState; }
  isConnected():            boolean      { return this.device !== null; }
  getStatus():              DeviceStatus { return this._status; }
  getConnectedDeviceName(): string {
    return this.device?.name ?? this.lastConnectedDevice?.name ?? "BlowSafe";
  }

  // ── Scan ─────────────────────────────────────────────────────────────────────
  async scan(): Promise<ScannedDevice[]> {
    if (this.bleState !== State.PoweredOn) {
      this.emit({ type: "error", message: "Bluetooth is off — please enable it first." });
      return [];
    }

    this.foundDevices.clear();
    this._setStatus("scanning");

    return new Promise<ScannedDevice[]>((resolve) => {
      const timer = setTimeout(() => {
        this.ble.stopDeviceScan();
        const devices = this._sortedDevices();
        if (devices.length === 0) {
          this.emit({
            type:    "error",
            message: "No BlowSafe devices found. Ensure the device is powered on and nearby.",
          });
        }
        this._setStatus("disconnected");
        resolve(devices);
      }, SCAN_TIMEOUT);

      this.ble.startDeviceScan(
        null,
        { allowDuplicates: false },
        (err, d) => {
          if (err) {
            clearTimeout(timer);
            this.ble.stopDeviceScan();
            this.emit({ type: "error", message: `Scan error: ${err.message}` });
            this._setStatus("disconnected");
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
  async connect(device: ScannedDevice): Promise<void> {
    if (this._isConnecting) {
      throw new Error("Already connecting — please wait.");
    }
    if (this._isDisconnecting) {
      throw new Error("Disconnecting in progress — please wait.");
    }
    if (this.bleState !== State.PoweredOn) {
      throw new Error("Bluetooth is off — enable it first.");
    }
    if (this.device) {
      throw new Error("Already connected — disconnect first.");
    }

    this._clearRetryTimer();
    this._isConnecting       = true;
    this._intentionalDisconnect = false;

    this.ble.stopDeviceScan();
    this._setStatus("connecting");
    this.emit({ type: "debug", message: `Connecting to ${device.name} (${device.id})` });

    try {
      // Cancel any stale OS-level connection for this device
      const alreadyConn = await this.ble.isDeviceConnected(device.id).catch(() => false);
      if (alreadyConn) {
        this.emit({ type: "debug", message: "Cancelling stale OS connection" });
        await this.ble.cancelDeviceConnection(device.id).catch(() => {});
        await _sleep(500);
      }

      // Connect with timeout
      this.device = await _withTimeout(
        this.ble.connectToDevice(device.id, { autoConnect: false }),
        CONN_TIMEOUT,
        "Connection timed out — ensure BlowSafe is on and nearby."
      );

      this.emit({ type: "debug", message: "Connected, discovering services…" });
      await this.device.discoverAllServicesAndCharacteristics();

      // Subscribe BEFORE any write — Arduino R4 must see subscription first
      this._setupMonitor();
      this.emit({ type: "debug", message: "Monitor active" });

      // R4 ArduinoBLE needs time to settle after GATT negotiation
      await _sleep(1_200);

      // Request current device state — response arrives via monitor
      await this.wq.enqueue("STATUS", false);
      this.emit({ type: "debug", message: "STATUS sent" });

      // Register disconnect handler
      this.device.onDisconnected((_err, _d) => {
        const wasIntentional = this._intentionalDisconnect;
        this.emit({
          type:    "debug",
          message: `onDisconnected fired — intentional: ${wasIntentional}`,
        });
        this._stopHeartbeat();
        this._cleanupDevice(wasIntentional ? null : "Connection lost.");

        if (!wasIntentional && this.retryCount < MAX_RETRIES) {
          this._scheduleRetry(device);
        } else if (!wasIntentional) {
          this.retryCount = 0;
        }
      });

      this.lastConnectedDevice = device;
      this.retryCount          = 0;

      // Start heartbeat AFTER confirmed connection
      this._startHeartbeat();

      this._setStatus("connected");

    } catch (err: any) {
      this._cleanupDevice(null);
      const msg = _friendlyError(err);
      this.emit({ type: "error",  message: msg });
      this._setStatus("disconnected");
      throw new Error(msg);
    } finally {
      this._isConnecting = false;
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────────
  // Sends PING every HEARTBEAT_INTERVAL ms.
  // If no PONG arrives within HEARTBEAT_TIMEOUT, the device is considered lost.
  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.lastPongAt = Date.now();

    this.heartbeatTimer = setInterval(async () => {
      if (!this.device) { this._stopHeartbeat(); return; }

      // If we already have a pending pong timer, previous ping was unanswered
      if (this.pongTimer) {
        this.emit({ type: "debug", message: "Heartbeat: no PONG — device lost" });
        this._stopHeartbeat();
        this._cleanupDevice("Device stopped responding.");
        if (this.lastConnectedDevice && this.retryCount < MAX_RETRIES) {
          this._scheduleRetry(this.lastConnectedDevice);
        }
        return;
      }

      try {
        await this.wq.enqueue("PING", false);
        this.emit({ type: "debug", message: "Heartbeat PING sent" });

        // Start pong timeout
        this.pongTimer = setTimeout(() => {
          this.pongTimer = null;
          // pongTimer expired without being cleared = no PONG received
          // Next heartbeat cycle will detect this
        }, HEARTBEAT_TIMEOUT);
      } catch {
        // Write failed — device likely gone
        this._stopHeartbeat();
        this._cleanupDevice("Device not responding.");
      }
    }, HEARTBEAT_INTERVAL);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.pongTimer)      { clearTimeout(this.pongTimer);       this.pongTimer      = null; }
  }

  // ── Auto-retry ────────────────────────────────────────────────────────────────
  private _scheduleRetry(device: ScannedDevice): void {
    this._clearRetryTimer();
    this.retryCount++;
    const delay = RETRY_DELAY * this.retryCount;
    this.emit({
      type:    "debug",
      message: `Scheduling retry ${this.retryCount}/${MAX_RETRIES} in ${delay}ms`,
    });

    this.retryTimer = setTimeout(async () => {
      if (this._isConnecting || this._isDisconnecting || this._intentionalDisconnect) return;
      try {
        await this.connect(device);
      } catch {
        if (this.retryCount >= MAX_RETRIES) {
          this.emit({
            type:    "error",
            message: "Could not reconnect after multiple attempts. Tap Scan to reconnect manually.",
          });
          this.retryCount = 0;
        }
      }
    }, delay);
  }

  private _clearRetryTimer(): void {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  // ── Monitor ───────────────────────────────────────────────────────────────────
  private _setupMonitor(): void {
    if (!this.device) return;
    this._teardownMonitor();

    this.monitorSub = this.device.monitorCharacteristicForService(
      SERVICE_UUID,
      TX_UUID,
      (err, char) => {
        if (err) {
          const msg = err.message ?? "";
          // These are expected during intentional disconnect — suppress
          if (/cancelled|disconnected|destroyed/i.test(msg)) return;
          this.emit({ type: "debug", message: `Monitor error: ${msg}` });
          return;
        }
        if (!char?.value) return;

        let text: string;
        try {
          text = Buffer.from(char.value, "base64").toString("utf-8");
        } catch {
          return;
        }

        this.rxBuffer += text;
        const lines    = this.rxBuffer.split("\n");
        this.rxBuffer  = lines.pop() ?? "";
        lines.forEach(l => {
          const t = l.trim();
          if (t) {
            this.emit({ type: "debug", message: `RX: ${t}` });
            this._parseLine(t);
          }
        });
      }
    );
  }

  // ── Line parser ───────────────────────────────────────────────────────────────
  private _parseLine(line: string): void {
    // STATE:<status>:<battery>
    if (line.startsWith("STATE:")) {
      const [, state = "", battRaw = ""] = line.split(":");
      const batt = _safeInt(battRaw);
      if (batt >= 0) this.emit({ type: "battery", level: batt });

      const statusMap: Record<string, DeviceStatus> = {
        READY:    "ready",
        WARMUP:   "warmup",
        SCANNING: "scanning_bac",
        FAIL:     "error",
        RECAL:    "recalibrating",
      };
      const mapped = statusMap[state.trim().toUpperCase()];
      if (mapped) {
        this._setStatus(mapped);
        if (state.trim().toUpperCase() === "RECAL") this.emit({ type: "recal" });
      }
      return;
    }

    // PONG:<battery>
    if (line.startsWith("PONG:")) {
      const batt = _safeInt(line.slice(5));
      if (batt >= 0) this.emit({ type: "battery", level: batt });
      // Clear pong timeout — heartbeat confirmed alive
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer  = null;
        this.lastPongAt = Date.now();
        this.emit({ type: "debug", message: "Heartbeat PONG received" });
      }
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
      // Device returns to ready automatically after a reading
      this._setStatus("ready");
      return;
    }

    // ERR:<code>
    if (line.startsWith("ERR:")) {
      const errMessages: Record<string, string> = {
        WARMUP: "Device still warming up — wait 60 s then try again.",
        RECAL:  "Device is recalibrating — please wait.",
        SENSOR: "Sensor fault — check hardware.",
      };
      const code = line.slice(4).trim().toUpperCase();
      this.emit({ type: "error", message: errMessages[code] ?? `Device error: ${code}` });
      // Error during BAC scan — return to ready if device is healthy
      if (code !== "SENSOR") this._setStatus("ready");
      return;
    }

    // Bare state tokens
    const stateMap: Record<string, DeviceStatus> = {
      READY:    "ready",
      WARMUP:   "warmup",
      SCANNING: "scanning_bac",
      RECAL:    "recalibrating",
      STABLE:   "ready",
    };
    const bare = stateMap[line.toUpperCase()];
    if (bare) {
      this._setStatus(bare);
      if (line.toUpperCase() === "RECAL")  this.emit({ type: "recal"  });
      if (line.toUpperCase() === "STABLE") this.emit({ type: "stable" });
    }
  }

  // ── Status helper — always go through here ────────────────────────────────────
  private _setStatus(s: DeviceStatus): void {
    this.emit({ type: "status", status: s });
  }

  // ── Public commands ────────────────────────────────────────────────────────────
  async requestScan():   Promise<void> { await this.wq.enqueue("SCAN",   true);  }
  async requestStatus(): Promise<void> { await this.wq.enqueue("STATUS", false); }
  async ping():          Promise<void> { await this.wq.enqueue("PING",   false); }

  // ── Disconnect ────────────────────────────────────────────────────────────────
  async disconnect(): Promise<void> {
    if (this._isDisconnecting) return;
    this._isDisconnecting       = true;
    this._intentionalDisconnect = true;

    this._clearRetryTimer();
    this._stopHeartbeat();
    this.retryCount = 0;
    this.wq.drain();
    this._teardownMonitor();

    try { await this.device?.cancelConnection(); } catch { /* expected */ }

    this.device      = null;
    this.rxBuffer    = "";
    this._isDisconnecting = false;
    this._setStatus("disconnected");
  }

  // ── Internal cleanup (unexpected drops) ───────────────────────────────────────
  private _cleanupDevice(errorMessage: string | null): void {
    this._stopHeartbeat();
    this.wq.drain();
    this._teardownMonitor();
    this.device   = null;
    this.rxBuffer = "";
    if (errorMessage) this.emit({ type: "error", message: errorMessage });
    this._setStatus("disconnected");
  }

  private _teardownMonitor(): void {
    try { this.monitorSub?.remove(); } catch { /* ignore */ }
    this.monitorSub = null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function _withTimeout<T>(
  promise: Promise<T>,
  ms:      number,
  message: string
): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
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
    case 2:   return "Connection cancelled — please try again.";
    case 3:   return "Connection timed out — ensure BlowSafe is on and nearby.";
    case 200: return "Connection failed — move closer and try again.";
    case 203: return "Device already connected.";
    case 205: return "Device not connected.";
    default:  return err?.message ?? "Connection failed — please try again.";
  }
}

export const breathalyser = new BreathalyserManager();