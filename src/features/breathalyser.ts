import { BleManager, State, type Device, type Subscription } from "react-native-ble-plx";
import { Buffer } from "buffer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SQLite from "react-native-sqlite-2";

// ── BLE Configuration ─────────────────────────────────────────────────────────
const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const TX_UUID      = "12345678-1234-1234-1234-123456789abd";
const RX_UUID      = "12345678-1234-1234-1234-123456789abe";

// ── Timing Constants ──────────────────────────────────────────────────────────
const SCAN_TIMEOUT       = 10_000;
const CONN_TIMEOUT       = 12_000;
const HANDSHAKE_TIMEOUT  = 3_000;
const MAX_RETRIES        = 3;
const RETRY_DELAY        = 2_000;
const HEARTBEAT_INTERVAL = 15_000;
const HEARTBEAT_TIMEOUT  = 8_000;
const MAX_STALE_MS       = 5_000;
const DEFAULT_READING_TIMEOUT = 45_000; // Zimbabwe legal blow time

// ── Cache & DB ────────────────────────────────────────────────────────────────
const CACHE_KEY = "@blowsafe:last_device";
const DB_NAME = "blowsafe.db";
const DB_VERSION = 1;
const DB_DISPLAY_NAME = "BlowSafe Database";
const DB_SIZE = 5 * 1024 * 1024; // 5MB

// ── Types ─────────────────────────────────────────────────────────────────────
export type DeviceStatus =
  | "disconnected" | "scanning" | "connecting" | "connected"
  | "warmup" | "ready" | "scanning_bac" | "recalibrating" | "error";

export interface BACResult {
  bac: number;
  bacPercent: string;
  bacMg: string;
  status: "PASS" | "FAIL";
  legalLimit: number;
  overLimit: boolean;
  timestamp: number;
  sequence?: number;
}

export interface ScannedDevice {
  id: string;
  name: string;
  rssi: number;
}

export type BreathalyserEvent =
  | { type: "status"; status: DeviceStatus }
  | { type: "result"; result: BACResult }
  | { type: "battery"; level: number }
  | { type: "recal" }
  | { type: "stable" }
  | { type: "error"; message: string }
  | { type: "scan_result"; devices: ScannedDevice[] }
  | { type: "ble_state"; state: State }
  | { type: "debug"; message: string }
  | { type: "accessibility"; message: string; priority?: "assertive" | "polite" } // NEW
  | { type: "progress"; step: "command_sent" | "awaiting_sensor" | "parsing" | "saving" | "complete" }; // NEW

type Listener = (event: BreathalyserEvent) => void;

interface WriteJob {
  cmd: string;
  withResponse: boolean;
  resolve: () => void;
  reject: (err: Error) => void;
}

// ── NEW: Queued Command for Offline Mode ──────────────────────────────────────
export interface QueuedCommand {
  id: string;
  type: "SCAN" | "STATUS" | "PING";
  payload: string | null;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: number;
  timeoutMs: number;
}

// ── NEW: Get Reading Options/Result ───────────────────────────────────────────
export interface GetReadingOptions {
  timeoutMs?: number;
  requireReady?: boolean;
  validateSequence?: boolean;
  onProgress?: (step: "command_sent" | "awaiting_sensor" | "parsing" | "saving" | "complete") => void;
  onAccessibilityAnnouncement?: (message: string, priority?: "assertive" | "polite") => void;
  enableQueue?: boolean;
  maxQueueRetries?: number;
  queueRetryDelayMs?: number;
  testMode?: boolean;
  mockResult?: BACResult | null;
}

export type GetReadingResult =
  | { success: true; result: BACResult; savedToDB: boolean }
  | {
      success: false;
      error: "device_not_ready" | "already_reading" | "timeout" | "parse_error" | "ble_drop" | "user_cancelled";
      message?: string;
      queued?: boolean;
      requiresConfirmation?: boolean;
    };

// ── WriteQueue (unchanged) ────────────────────────────────────────────────────
class WriteQueue {
  private queue: WriteJob[] = [];
  private running = false;
  _exec: (job: WriteJob) => Promise<void> = async () => {};

  enqueue(cmd: string, withResponse: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, withResponse, resolve, reject });
      this.flush();
    });
  }

  private async flush(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const job = this.queue.shift()!;
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
    this.queue = [];
    this.running = false;
  }

  get size(): number { return this.queue.length; }
}

// ── NEW: SQLite Helpers ───────────────────────────────────────────────────────
let dbInstance: SQLite.SQLiteDatabase | null = null;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  
  dbInstance = await SQLite.openDatabase(
    DB_NAME, DB_VERSION, DB_DISPLAY_NAME, DB_SIZE
  );
  
  // Initialize schema
  await dbInstance.executeSql(`
    CREATE TABLE IF NOT EXISTS bac_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bac_value REAL NOT NULL,
      bac_percent TEXT NOT NULL,
      bac_mg TEXT NOT NULL,
      status TEXT CHECK(status IN ('PASS', 'FAIL')) NOT NULL,
      legal_limit REAL NOT NULL,
      over_limit INTEGER NOT NULL,
      sequence INTEGER,
      timestamp INTEGER NOT NULL,
      device_id TEXT,
      synced INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);
  
  await dbInstance.executeSql(
    `CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON bac_readings(timestamp DESC)`
  );
  
  return dbInstance;
}

export async function saveResultToDB(
  result: BACResult,
  deviceId?: string
): Promise<boolean> {
  try {
    const db = await getDatabase();
    await db.executeSql(
      `INSERT INTO bac_readings 
       (bac_value, bac_percent, bac_mg, status, legal_limit, over_limit, sequence, timestamp, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.bac,
        result.bacPercent,
        result.bacMg,
        result.status,
        result.legalLimit,
        result.overLimit ? 1 : 0,
        result.sequence ?? null,
        result.timestamp,
        deviceId ?? null
      ]
    );
    return true;
  } catch (err) {
    console.error("[SQLite] Save failed:", err);
    return false;
  }
}

export async function getReadingHistory(limit: number = 20): Promise<BACResult[]> {
  try {
    const db = await getDatabase();
    const results = await db.executeSql(
      `SELECT * FROM bac_readings ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    
    return results[0].rows?.map?.((row: any) => ({
      bac: row.bac_value,
      bacPercent: row.bac_percent,
      bacMg: row.bac_mg,
      status: row.status as "PASS" | "FAIL",
      legalLimit: row.legal_limit,
      overLimit: row.over_limit === 1,
      timestamp: row.timestamp,
      sequence: row.sequence ?? undefined,
    })) ?? [];
  } catch (err) {
    console.error("[SQLite] History fetch failed:", err);
    return [];
  }
}

// ── NEW: Command Queue Processor (Offline Mode) ───────────────────────────────
class CommandQueue {
  private queue: QueuedCommand[] = [];
  private processorInterval: ReturnType<typeof setInterval> | null = null;
  private breathalyser: BreathalyserManager;
  
  constructor(breathalyser: BreathalyserManager) {
    this.breathalyser = breathalyser;
  }
  
  enqueue(cmd: Omit<QueuedCommand, "id" | "createdAt" | "nextRetryAt" | "retryCount">): QueuedCommand {
    const command: QueuedCommand = {
      ...cmd,
      id: `${cmd.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      nextRetryAt: Date.now(),
      retryCount: 0,
    };
    this.queue.push(command);
    this.startProcessor();
    return command;
  }
  
  private startProcessor(): void {
    if (this.processorInterval) return;
    
    this.processorInterval = setInterval(async () => {
      if (!this.breathalyser.isConnected()) return;
      
      const now = Date.now();
      const eligible = this.queue.filter(c => 
        c.nextRetryAt <= now && c.retryCount < c.maxRetries
      );
      
      for (const cmd of eligible) {
        try {
          if (cmd.type === "SCAN") {
            await this.breathalyser.requestScan();
          }
          // Add other command types as needed
          
          // Success: remove from queue
          this.queue = this.queue.filter(c => c.id !== cmd.id);
        } catch {
          // Retry with exponential backoff
          cmd.retryCount++;
          const baseDelay = cmd.queueRetryDelayMs ?? 2000;
          cmd.nextRetryAt = now + Math.min(baseDelay * Math.pow(2, cmd.retryCount - 1), 30000);
        }
      }
      
      // Stop processor if queue is empty
      if (this.queue.length === 0 && this.processorInterval) {
        clearInterval(this.processorInterval);
        this.processorInterval = null;
      }
    }, 2000);
  }
  
  getPendingCount(): number {
    return this.queue.length;
  }
  
  clear(): void {
    this.queue = [];
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = null;
    }
  }
}

// ── Main Manager Class ────────────────────────────────────────────────────────
export class BreathalyserManager {
  private ble = new BleManager();
  private device: Device | null = null;
  private listeners: Listener[] = [];
  private rxBuffer = "";
  private monitorSub: Subscription | null = null;
  private bleStateSub: Subscription | null = null;
  private foundDevices = new Map<string, ScannedDevice>();
  private bleState: State = State.Unknown;

  // Lifecycle guards
  private _isConnecting = false;
  private _isDisconnecting = false;
  private _intentionalDisconnect = false;

  // Retry state
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConnectedDevice: ScannedDevice | null = null;

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPongAt = 0;

  // Spoof-test resilience
  private lastSequence = -1;
  private testMode = false;

  // NEW: Command queue for offline mode
  private commandQueue: CommandQueue;

  // Status
  private _status: DeviceStatus = "disconnected";
  private wq = new WriteQueue();

  constructor() {
    this.commandQueue = new CommandQueue(this);
    
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

  // ── Event Bus ───────────────────────────────────────────────────────────────
  on(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(event: BreathalyserEvent): void {
    if (event.type === "status") {
      this._status = event.status;
    }
    this.listeners.forEach(l => {
      try { l(event); } catch { /* never crash the manager */ }
    });
  }

  // ── Public Getters ──────────────────────────────────────────────────────────
  getBLEState(): State { return this.bleState; }
  isConnected(): boolean { return this.device !== null; }
  getStatus(): DeviceStatus { return this._status; }
  getConnectedDeviceName(): string {
    return this.device?.name ?? this.lastConnectedDevice?.name ?? "BlowSafe";
  }
  getPendingQueueCount(): number {
    return this.commandQueue.getPendingCount();
  }

  // ── Test Mode Toggle ────────────────────────────────────────────────────────
  setTestMode(enabled: boolean): void {
    this.testMode = enabled;
    this.emit({ 
      type: "debug", 
      message: enabled ? "⚠️ SPOOF-TEST MODE: Accepting malformed payloads" : "✅ Normal mode" 
    });
  }

  // ── Scan (UUID filtering) ───────────────────────────────────────────────────
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
            type: "error",
            message: "No BlowSafe devices found. Ensure the device is powered on and nearby.",
          });
        }
        this._setStatus("disconnected");
        resolve(devices);
      }, SCAN_TIMEOUT);

      this.ble.startDeviceScan(
        [SERVICE_UUID],
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

  // ── Connect Cached ──────────────────────────────────────────────────────────
  async connectCached(): Promise<boolean> {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (!cached) return false;
      const device = JSON.parse(cached) as ScannedDevice;
      
      const isConn = await this.ble.isDeviceConnected(device.id).catch(() => false);
      if (isConn) {
        await this.connect(device);
        return true;
      }
      await this.connect(device);
      return true;
    } catch {
      return false;
    }
  }

  // ── Connect (MTU + Handshake) ───────────────────────────────────────────────
  async connect(device: ScannedDevice): Promise<void> {
    if (this._isConnecting) throw new Error("Already connecting — please wait.");
    if (this._isDisconnecting) throw new Error("Disconnecting in progress — please wait.");
    if (this.bleState !== State.PoweredOn) throw new Error("Bluetooth is off — enable it first.");
    if (this.device) throw new Error("Already connected — disconnect first.");

    this._clearRetryTimer();
    this._isConnecting = true;
    this._intentionalDisconnect = false;

    this.ble.stopDeviceScan();
    this._setStatus("connecting");
    this.emit({ type: "debug", message: `Connecting to ${device.name} (${device.id})` });

    let handshakeResolved = false;
    const handshakeTimeout = setTimeout(() => {
      if (!handshakeResolved) {
        this.emit({ type: "debug", message: "Handshake timeout" });
        this._cleanupDevice("Device not responding to handshake.");
      }
    }, HANDSHAKE_TIMEOUT);

    const completeHandshake = () => {
      if (handshakeResolved) return;
      handshakeResolved = true;
      clearTimeout(handshakeTimeout);
      this._setStatus("ready");
      this.emit({ type: "debug", message: "Handshake complete — device ready" });
    };

    try {
      const alreadyConn = await this.ble.isDeviceConnected(device.id).catch(() => false);
      if (alreadyConn) {
        await this.ble.cancelDeviceConnection(device.id).catch(() => {});
        await _sleep(500);
      }

      this.device = await _withTimeout(
        this.ble.connectToDevice(device.id, { autoConnect: false }),
        CONN_TIMEOUT,
        "Connection timed out — ensure BlowSafe is on and nearby."
      );

      await this.device.discoverAllServicesAndCharacteristics();

      try {
        await this.device.requestMTU(185);
        this.emit({ type: "debug", message: "MTU negotiated (185 bytes)" });
      } catch {
        this.emit({ type: "debug", message: "MTU request failed, using default 20B" });
      }

      this._setupMonitor();
      this.emit({ type: "debug", message: "Monitor active" });
      await _sleep(1_200);
      await this.wq.enqueue("STATUS", false);
      this.emit({ type: "debug", message: "STATUS sent — awaiting handshake" });

      this.device.onDisconnected((_err, _d) => {
        const wasIntentional = this._intentionalDisconnect;
        this.emit({
          type: "debug",
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

      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(device));
      
      this.lastConnectedDevice = device;
      this.retryCount = 0;
      this._setStatus("connected");
      this._startHeartbeat();

    } catch (err: any) {
      clearTimeout(handshakeTimeout);
      this._cleanupDevice(null);
      const msg = _friendlyError(err);
      this.emit({ type: "error", message: msg });
      this._setStatus("disconnected");
      throw new Error(msg);
    } finally {
      this._isConnecting = false;
    }
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────
  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.lastPongAt = Date.now();

    this.heartbeatTimer = setInterval(async () => {
      if (!this.device) { this._stopHeartbeat(); return; }
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
        this.pongTimer = setTimeout(() => { this.pongTimer = null; }, HEARTBEAT_TIMEOUT);
      } catch {
        this._stopHeartbeat();
        this._cleanupDevice("Device not responding.");
      }
    }, HEARTBEAT_INTERVAL);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  // ── Auto-retry ──────────────────────────────────────────────────────────────
  private _scheduleRetry(device: ScannedDevice): void {
    this._clearRetryTimer();
    this.retryCount++;
    const delay = RETRY_DELAY * this.retryCount;
    this.emit({
      type: "debug",
      message: `Scheduling retry ${this.retryCount}/${MAX_RETRIES} in ${delay}ms`,
    });

    this.retryTimer = setTimeout(async () => {
      if (this._isConnecting || this._isDisconnecting || this._intentionalDisconnect) return;
      try {
        await this.connect(device);
      } catch {
        if (this.retryCount >= MAX_RETRIES) {
          this.emit({
            type: "error",
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

  // ── Monitor ─────────────────────────────────────────────────────────────────
  private _setupMonitor(): void {
    if (!this.device) return;
    this._teardownMonitor();

    this.monitorSub = this.device.monitorCharacteristicForService(
      SERVICE_UUID,
      TX_UUID,
      (err, char) => {
        if (err) {
          const msg = err.message ?? "";
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
        const lines = this.rxBuffer.split("\n");
        this.rxBuffer = lines.pop() ?? "";
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

  // ── Line Parser (Spoof-Test Validation) ─────────────────────────────────────
  private _parseLine(line: string): void {
    if (line.startsWith("STATE:")) {
      const [, state = "", battRaw = ""] = line.split(":");
      const batt = _safeInt(battRaw);
      if (batt >= 0) this.emit({ type: "battery", level: batt });

      const statusMap: Record<string, DeviceStatus> = {
        READY: "ready", WARMUP: "warmup", SCANNING: "scanning_bac",
        FAIL: "error", RECAL: "recalibrating",
      };
      const mapped = statusMap[state.trim().toUpperCase()];
      if (mapped) {
        this._setStatus(mapped);
        if (state.trim().toUpperCase() === "RECAL") this.emit({ type: "recal" });
        if (state.trim().toUpperCase() === "READY" && this._status === "connected") {
          this._setStatus("ready");
        }
      }
      return;
    }

    if (line.startsWith("PONG:")) {
      const batt = _safeInt(line.slice(5));
      if (batt >= 0) this.emit({ type: "battery", level: batt });
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
        this.lastPongAt = Date.now();
        this.emit({ type: "debug", message: "Heartbeat PONG received" });
      }
      if (this._status === "connected") {
        this._setStatus("ready");
      }
      return;
    }

    if (line.startsWith("BAC:")) {
      const parts = line.split(":");
      const bac = _safeFloat(parts[1] ?? "");
      const isFail = (parts[2] ?? "").trim().toUpperCase() === "FAIL";
      
      const seq = _safeInt(parts[3] ?? "-1");
      const ts = _safeInt(parts[4] ?? "0");

      if (!this.testMode) {
        if (seq >= 0 && seq <= this.lastSequence) {
          this.emit({ type: "debug", message: `⚠️ Rejected stale packet seq:${seq}` });
          return;
        }
        if (ts > 0 && Date.now() - ts > MAX_STALE_MS) {
          this.emit({ type: "debug", message: `⚠️ Rejected stale timestamp:${ts}` });
          return;
        }
      }
      
      if (seq >= 0) this.lastSequence = seq;

      if (isNaN(bac)) {
        this.emit({ type: "error", message: "Malformed BAC reading — please retry." });
        return;
      }

      const result: BACResult = {
        bac,
        bacPercent: `${bac.toFixed(3)}%`,
        bacMg: `${Math.round(bac * 1000)} mg/100ml`,
        status: isFail ? "FAIL" : "PASS",
        legalLimit: 0.08,
        overLimit: isFail,
        timestamp: Date.now(),
        sequence: seq >= 0 ? seq : undefined,
      };
      
      // NEW: Emit progress before saving
      this.emit({ type: "progress", step: "parsing" });
      
      // NEW: Save to SQLite (non-blocking)
      saveResultToDB(result, this.device?.id).then(saved => {
        this.emit({ type: "progress", step: saved ? "saving" : "complete" });
      });
      
      this.emit({ type: "result", result });
      this._setStatus("ready");
      return;
    }

    if (line.startsWith("ERR:")) {
      const errMessages: Record<string, string> = {
        WARMUP: "Device still warming up — wait 60 s then try again.",
        RECAL: "Device is recalibrating — please wait.",
        SENSOR: "Sensor fault — check hardware.",
      };
      const code = line.slice(4).trim().toUpperCase();
      this.emit({ type: "error", message: errMessages[code] ?? `Device error: ${code}` });
      if (code !== "SENSOR") this._setStatus("ready");
      return;
    }

    const stateMap: Record<string, DeviceStatus> = {
      READY: "ready", WARMUP: "warmup", SCANNING: "scanning_bac",
      RECAL: "recalibrating", STABLE: "ready",
    };
    const bare = stateMap[line.toUpperCase()];
    if (bare) {
      this._setStatus(bare);
      if (line.toUpperCase() === "RECAL") this.emit({ type: "recal" });
      if (line.toUpperCase() === "STABLE") this.emit({ type: "stable" });
    }
  }

  private _setStatus(s: DeviceStatus): void {
    this.emit({ type: "status", status: s });
  }

  // ── Public Commands ─────────────────────────────────────────────────────────
  async requestScan(): Promise<void> { await this.wq.enqueue("SCAN", true); }
  async requestStatus(): Promise<void> { await this.wq.enqueue("STATUS", false); }
  async ping(): Promise<void> { await this.wq.enqueue("PING", false); }

  // ── NEW: Get Reading Helper (Main Entry Point) ──────────────────────────────
  async getReading(options: GetReadingOptions = {}): Promise<GetReadingResult> {
    const {
      timeoutMs = DEFAULT_READING_TIMEOUT,
      requireReady = true,
      validateSequence = true,
      onProgress,
      onAccessibilityAnnouncement,
      enableQueue = true,
      maxQueueRetries = 3,
      queueRetryDelayMs = 2000,
      testMode = false,
      mockResult = null,
    } = options;

    // Test mode override
    if (testMode) this.testMode = true;
    
    // Mock result for testing
    if (mockResult) {
      onProgress?.("command_sent");
      onProgress?.("awaiting_sensor");
      onProgress?.("parsing");
      await _sleep(1500); // Simulate sensor delay
      onProgress?.("saving");
      await saveResultToDB(mockResult, this.device?.id);
      onProgress?.("complete");
      onAccessibilityAnnouncement?.(
        `Reading complete. ${mockResult.overLimit ? 'Over limit' : 'Within limit'}. ${mockResult.bacPercent}.`,
        "assertive"
      );
      return { success: true, result: mockResult, savedToDB: true };
    }

    // Validate preconditions
    if (!this.isConnected()) {
      return { success: false, error: "device_not_ready", message: "No device connected", requiresConfirmation: true };
    }
    
    const currentStatus = this.getStatus();
    if (requireReady && currentStatus !== "ready" && currentStatus !== "connected") {
      return { success: false, error: "device_not_ready", message: "Device not ready", requiresConfirmation: true };
    }
    
    if (this._status === "scanning_bac") {
      return { success: false, error: "already_reading", message: "Already reading", requiresConfirmation: false };
    }

    // Enter loading state
    onProgress?.("command_sent");
    onAccessibilityAnnouncement?.("Reading started. Please blow steadily into the device.", "assertive");

    try {
      // Send SCAN command
      await this.requestScan();
      onProgress?.("awaiting_sensor");
      onAccessibilityAnnouncement?.("Sensor active. Blow now.", "assertive");

      // Wait for result with timeout
      const result = await Promise.race([
        new Promise<BACResult>((resolve) => {
          const unsub = this.on((event) => {
            if (event.type === "result") {
              unsub();
              resolve(event.result);
            }
          });
        }),
        _sleep(timeoutMs).then(() => { throw new Error("TIMEOUT"); })
      ]);

      // Validate sequence if enabled
      if (validateSequence && !testMode && result.sequence !== undefined) {
        if (result.sequence <= this.lastSequence) {
          return { success: false, error: "parse_error", message: "Rejected stale packet", requiresConfirmation: true };
        }
        this.lastSequence = result.sequence;
      }

      // Save to DB (non-blocking but wait for progress update)
      onProgress?.("parsing");
      const saved = await saveResultToDB(result, this.device?.id);
      onProgress?.(saved ? "saving" : "complete");
      
      // Accessibility announcement
      onAccessibilityAnnouncement?.(
        `Reading complete. ${result.overLimit ? 'Over legal limit — FAIL' : 'Within legal limit — PASS'}. ${result.bacPercent}.`,
        "assertive"
      );
      
      onProgress?.("complete");
      return { success: true, result, savedToDB: saved };

    } catch (err: any) {
      const isTimeout = err?.message === "TIMEOUT";
      const isBleDrop = !this.isConnected();
      
      // Handle BLE drop with queue
      if (isBleDrop && enableQueue) {
        this.commandQueue.enqueue({
          type: "SCAN",
          payload: null,
          maxRetries: maxQueueRetries,
          queueRetryDelayMs: queueRetryDelayMs,
          timeoutMs: timeoutMs,
        });
        
        onAccessibilityAnnouncement?.(
          "Connection lost. Command queued for retry when device reconnects.",
          "polite"
        );
        
        return { 
          success: false, 
          error: "ble_drop", 
          message: "Connection lost — command queued",
          queued: true,
          requiresConfirmation: true
        };
      }
      
      // Timeout or other error
      onAccessibilityAnnouncement?.(
        isTimeout ? "Reading timed out. Please try again." : "Reading failed. Please try again.",
        "assertive"
      );
      
      return { 
        success: false, 
        error: isTimeout ? "timeout" : "parse_error",
        message: isTimeout ? "Device took too long to respond" : err?.message,
        requiresConfirmation: true
      };
      
    } finally {
      // Cleanup is handled by context/events, but ensure progress ends
      onProgress?.("complete");
    }
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────
  async disconnect(): Promise<void> {
    if (this._isDisconnecting) return;
    this._isDisconnecting = true;
    this._intentionalDisconnect = true;

    this._clearRetryTimer();
    this._stopHeartbeat();
    this.retryCount = 0;
    this.wq.drain();
    this.commandQueue.clear(); // Clear pending commands on intentional disconnect
    this._teardownMonitor();

    try { await this.device?.cancelConnection(); } catch { /* expected */ }

    this.device = null;
    this.rxBuffer = "";
    this._isDisconnecting = false;
    this._setStatus("disconnected");
  }

  // ── Internal Cleanup ────────────────────────────────────────────────────────
  private _cleanupDevice(errorMessage: string | null): void {
    this._stopHeartbeat();
    this.wq.drain();
    this._teardownMonitor();
    this.device = null;
    this.rxBuffer = "";
    if (errorMessage) this.emit({ type: "error", message: errorMessage });
    this._setStatus("disconnected");
  }

  private _teardownMonitor(): void {
    try { this.monitorSub?.remove(); } catch { /* ignore */ }
    this.monitorSub = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function _withTimeout<T>(
  promise: Promise<T>,
  ms: number,
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
    case 2: return "Connection cancelled — please try again.";
    case 3: return "Connection timed out — ensure BlowSafe is on and nearby.";
    case 200: return "Connection failed — move closer and try again.";
    case 203: return "Device already connected.";
    case 205: return "Device not connected.";
    default: return err?.message ?? "Connection failed — please try again.";
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────
export const breathalyser = new BreathalyserManager();