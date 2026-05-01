/**
 * src/helpers/getReading.ts
 *
 * Orchestrates a single BAC reading cycle against the Arduino R4 firmware.
 *
 * Arduino protocol (from firmware):
 *  1. App sends "SCAN" over BLE RX characteristic.
 *  2. Arduino immediately emits "STATUS:SCANNING" to confirm receipt.
 *  3. Arduino runs a 20-second scan internally.
 *  4. Arduino emits "BAC:{value}" (e.g. "BAC:0.50") when done.
 *
 * This module:
 *  - Verifies the device is still connected before writing.
 *  - Sends the SCAN command.
 *  - Waits for STATUS:SCANNING confirmation (5s window).
 *  - Waits for the BAC result (35s window — generous buffer over 20s scan).
 *  - Returns a typed ReadingResult or throws a typed ReadingError.
 *  - Cleans up its own BLE listener regardless of outcome.
 */

import { breathalyser } from "../features/breathalyser";

// ─── Result type ─────────────────────────────────────────────────────────────

export interface ReadingResult {
  /** Raw BAC as a decimal (e.g. 0.05 = 0.05%) */
  bac: number;
  timestamp: number;
}

// ─── Error types ─────────────────────────────────────────────────────────────

export type ReadingErrorCode =
  | "DEVICE_NOT_CONNECTED"
  | "COMMAND_NOT_ACKNOWLEDGED"
  | "READING_TIMEOUT"
  | "INVALID_BAC_FORMAT"
  | "COMMAND_SEND_FAILED";

export class ReadingError extends Error {
  constructor(
    public readonly code: ReadingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ReadingError";
  }
}

// ─── Timing constants (ms) ───────────────────────────────────────────────────

/** How long to wait for STATUS:SCANNING after sending SCAN command. */
const ACK_TIMEOUT_MS = 5_000;

/**
 * How long to wait for a BAC result after STATUS:SCANNING is received.
 * The Arduino takes exactly 20 s; we add 15 s of margin for BLE latency.
 */
const BAC_TIMEOUT_MS = 35_000;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Request a breathalyser reading from the connected Arduino R4.
 *
 * @throws {ReadingError} with a specific code on any failure.
 */
export async function getReading(): Promise<ReadingResult> {
  // 1 ─ Guard: must be connected ─────────────────────────────────────────────
  const connected = await breathalyser.isStillConnected();
  if (!connected) {
    throw new ReadingError(
      "DEVICE_NOT_CONNECTED",
      "No breathalyser is connected. Please connect a device first."
    );
  }

  // 2 ─ Send SCAN command ─────────────────────────────────────────────────────
  try {
    await breathalyser.sendCommand("SCAN");
  } catch {
    throw new ReadingError(
      "COMMAND_SEND_FAILED",
      "Failed to send scan command to the device. Try reconnecting."
    );
  }

  // 3 ─ Wait for STATUS:SCANNING acknowledgement ──────────────────────────────
  await waitForAck();

  // 4 ─ Wait for BAC result ───────────────────────────────────────────────────
  return await waitForBac();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolves when the Arduino sends STATUS:SCANNING.
 * Rejects with ReadingError("COMMAND_NOT_ACKNOWLEDGED") on timeout.
 */
function waitForAck(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(
        new ReadingError(
          "COMMAND_NOT_ACKNOWLEDGED",
          "The device did not acknowledge the scan command. Try again."
        )
      );
    }, ACK_TIMEOUT_MS);

    const unsub = breathalyser.on((event) => {
      if (event.type !== "reading") return;

      const msg = event.value.trim();

      if (msg === "STATUS:SCANNING") {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

/**
 * Resolves with a ReadingResult when the Arduino sends BAC:{value}.
 * Rejects with ReadingError("READING_TIMEOUT" | "INVALID_BAC_FORMAT") on failure.
 */
function waitForBac(): Promise<ReadingResult> {
  return new Promise<ReadingResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(
        new ReadingError(
          "READING_TIMEOUT",
          "The device did not return a result in time. Ensure the device is ready and try again."
        )
      );
    }, BAC_TIMEOUT_MS);

    const unsub = breathalyser.on((event) => {
      if (event.type !== "reading") return;

      const msg = event.value.trim();

      if (!msg.startsWith("BAC:")) return;

      clearTimeout(timer);
      unsub();

      const raw = msg.slice(4); // e.g. "0.50"
      const bac = parseFloat(raw);

      if (isNaN(bac) || bac < 0) {
        reject(
          new ReadingError(
            "INVALID_BAC_FORMAT",
            `The device returned an unrecognisable BAC value: "${raw}".`
          )
        );
        return;
      }

      resolve({ bac, timestamp: Date.now() });
    });
  });
}