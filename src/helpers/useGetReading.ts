import { breathalyser } from "../features/breathalyser";
import type { DeviceStatus } from "../features/breathalyser";

export type ReadingState =
  | "idle"
  | "warmup"
  | "ready"
  | "reading"
  | "recalibrating"
  | "done_pass"
  | "done_fail";

export function getReadingState(
  bleStatus:       DeviceStatus,
  deviceConnected: boolean,
  overLimit:       boolean | null
): ReadingState {
  if (!deviceConnected) return "idle";

  switch (bleStatus) {
    case "warmup":        return "warmup";
    case "scanning_bac":  return "reading";
    case "recalibrating": return "recalibrating";
    case "error":         return "idle";

    case "connected":
    case "ready":
      if (overLimit === true)  return "done_fail";
      if (overLimit === false) return "done_pass";
      return "ready";

    default:
      return "idle";
  }
}

export function getReadingLabel(state: ReadingState): string {
  const labels: Record<ReadingState, string> = {
    idle:          "No Device",
    warmup:        "Warming Up…",
    reading:       "Reading…",
    recalibrating: "Recalibrating…",
    done_pass:     "Get Reading",
    done_fail:     "Get Reading",
    ready:         "Get Reading",
  };
  return labels[state] ?? "Get Reading";
}

export function canPressReading(state: ReadingState): boolean {
  return state === "ready" || state === "done_pass" || state === "done_fail";
}

export async function triggerReading(
  bleStatus:   DeviceStatus,
  requestScan: () => Promise<void>
): Promise<void> {
  // Brief settle only needed if Arduino just entered "connected" and hasn't
  // transitioned to "ready" yet — STATUS was sent on connect so this is a
  // short window, not a polling loop.
  if (bleStatus === "connected") {
    await new Promise<void>(r => setTimeout(r, 500));
  }
  await requestScan();
}