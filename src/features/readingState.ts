import { breathalyser } from "../features/breathalyser";
import type { DeviceStatus } from "../features/breathalyser";

export type ReadingState =
  | "idle"
  | "warmup"
  | "ready"
  | "awaiting_bac"
  | "recalibrating"
  | "done_pass"
  | "done_fail"
  | "error";

// NEW: Extended state for UI feedback
export interface ExtendedReadingState {
  base: ReadingState;
  isQueued?: boolean;        // Command queued for retry
  queueRetryCount?: number;  // For progress indicator
  requiresConfirmation?: boolean; // User must confirm retry
}

export function getReadingState(
  bleStatus: DeviceStatus,
  deviceConnected: boolean,
  overLimit: boolean | null,
  isAwaitingBac: boolean,
): ReadingState {
  if (!deviceConnected) return "idle";
  if (isAwaitingBac) return "awaiting_bac";

  switch (bleStatus) {
    case "warmup": return "warmup";
    case "scanning_bac": return "awaiting_bac";
    case "recalibrating": return "recalibrating";
    case "error": return "error";
    case "connected":
    case "ready":
      if (overLimit === true) return "done_fail";
      if (overLimit === false) return "done_pass";
      return "ready";
    default: return "idle";
  }
}

export function getReadingLabel(
  state: ReadingState,
  isAwaitingBac: boolean,
): string {
  if (isAwaitingBac) return "Reading…";
  const labels: Record<ReadingState, string> = {
    idle: "No Device",
    warmup: "Warming Up…",
    awaiting_bac: "Reading…",
    recalibrating: "Recalibrating…",
    done_pass: "Get Reading",
    done_fail: "Get Reading",
    ready: "Get Reading",
    error: "Device Error",
  };
  return labels[state] ?? "Get Reading";
}

export function canPressReading(state: ReadingState, isAwaitingBac: boolean): boolean {
  if (isAwaitingBac) return false;
  return state === "ready" || state === "done_pass" || state === "done_fail";
}

export async function triggerReading(
  bleStatus: DeviceStatus,
  requestScan: () => Promise<void>,
): Promise<void> {
  if (bleStatus === "connected") {
    await new Promise<void>(r => setTimeout(r, 600));
  }
  await requestScan();
}