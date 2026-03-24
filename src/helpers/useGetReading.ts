// Plain helper — no hooks inside, just logic functions.
// Called from HomeScreen which owns all hooks.

import { breathalyser } from "../features/breathalyser";

export type ReadingState =
  | "idle"
  | "warmup"
  | "ready"
  | "reading"
  | "recalibrating"
  | "done_pass"
  | "done_fail";

export function getReadingState(
  bleStatus: string,          // remains string
  deviceConnected: boolean,
  overLimit: boolean | null
): ReadingState {
  if (!deviceConnected) return "idle";
  if (bleStatus === "warmup") return "warmup";
  if (bleStatus === "scanning_bac") return "reading";
  if (bleStatus === "recalibrating") return "recalibrating";
  if (bleStatus === "connected") return "ready";
  if (bleStatus === "ready") {
    if (overLimit === true) return "done_fail";
    if (overLimit === false) return "done_pass";
    return "ready";
  }
  return "idle";
}

export function getReadingLabel(state: ReadingState): string {
  switch (state) {
    case "idle": return "No Device";
    case "warmup": return "Warming Up…";
    case "reading": return "Reading…";
    case "recalibrating": return "Recalibrating…";
    case "done_pass": return "Get Reading";
    case "done_fail": return "Get Reading";
    case "ready": return "Get Reading";
    default: return "Get Reading";
  }
}

export function canPressReading(state: ReadingState): boolean {
  return (
    state === "ready" ||
    state === "done_pass" ||
    state === "done_fail"
  );
}

export async function triggerReading(
  bleStatus: string,
  requestScan: () => Promise<void>
): Promise<void> {
  // Removed ping() call — STATUS is already sent on connect
  // Extra writes were causing R4 to disconnect
  if (bleStatus === "connected") {
    // Give the device a moment to stabilise before scanning
    await new Promise(r => setTimeout(r, 500));
  }
  await requestScan();
}