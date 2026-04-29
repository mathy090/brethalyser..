import { useCallback } from "react";
import { State } from "react-native-ble-plx";
import { bleManager } from "../services/bleManager"

export function usePersistentBLE() {
  // ── AUTO CONNECT ON MOUNT ─────────────────────
  const autoConnectOnMount = useCallback(async () => {
    try {
      const state = await bleManager.getBLEState();

// ❗ Only block when truly OFF
if (state === State.PoweredOff) return;

// ❗ Wait for valid BLE states before connecting
if (state === State.Unknown || state === State.Resetting) {
  setTimeout(() => autoConnectOnMount(), 1000);
  return;
}

await bleManager.autoConnect();
bleManager.startPolling();
    } catch {
      // silent fail (no UI noise)
    }
  }, []);

  // ── MANUAL DISCONNECT ─────────────────────────
  const handleManualDisconnect = useCallback(async () => {
    try {
      bleManager.stopPolling(); // stop background reads
      await bleManager.disconnect(); // disables auto-reconnect internally
    } catch {
      // silent
    }
  }, []);

  return {
    autoConnectOnMount,
    handleManualDisconnect,
  };
}