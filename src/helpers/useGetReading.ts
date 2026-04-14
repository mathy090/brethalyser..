import { breathalyser } from "../features/breathalyser";
import type { DeviceStatus } from "../features/breathalyser";

export type ReadingState =
  | "idle"          // no device
  | "warmup"        // device on, heating sensor
  | "ready"         // device ready, no reading yet
  | "awaiting_bac"  // SCAN sent, waiting for BAC data
  | "recalibrating" // sensor elevated
  | "done_pass"     // last reading was PASS
  | "done_fail"     // last reading was FAIL
  | "error";        // device error state

export function getReadingState(
  bleStatus:     DeviceStatus,
  deviceConnected: boolean,
  overLimit:       boolean | null,
  isAwaitingBac:   boolean,
): ReadingState {
  if (!deviceConnected) return "idle";

  // isAwaitingBac is the authoritative loading flag —
  // check it before inspecting bleStatus so the UI
  // doesn't flicker between states mid-scan
  if (isAwaitingBac) return "awaiting_bac";

  switch (bleStatus) {
    case "warmup":        return "warmup";
    case "scanning_bac":  return "awaiting_bac";
    case "recalibrating": return "recalibrating";
    case "error":         return "error";

    case "connected":
    case "ready":
      if (overLimit === true)  return "done_fail";
      if (overLimit === false) return "done_pass";
      return "ready";

    default:
      return "idle";
  }
}

export function getReadingLabel(
  state:         ReadingState,
  isAwaitingBac: boolean,
): string {
  if (isAwaitingBac) return "Reading…";
  const labels: Record<ReadingState, string> = {
    idle:          "No Device",
    warmup:        "Warming Up…",
    awaiting_bac:  "Reading…",
    recalibrating: "Recalibrating…",
    done_pass:     "Get Reading",
    done_fail:     "Get Reading",
    ready:         "Get Reading",
    error:         "Device Error",
  };
  return labels[state] ?? "Get Reading";
}

export function canPressReading(state: ReadingState, isAwaitingBac: boolean): boolean {
  if (isAwaitingBac) return false;
  return state === "ready" || state === "done_pass" || state === "done_fail";
}

export async function triggerReading(
  bleStatus:    DeviceStatus,
  requestScan:  () => Promise<void>,
): Promise<void> {
  // If device just connected but hasn't confirmed ready yet, brief settle
  if (bleStatus === "connected") {
    await new Promise<void>(r => setTimeout(r, 600));
  }
  await requestScan();
}