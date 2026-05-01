import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Animated,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { State } from "react-native-ble-plx";
import { breathalyser, ScannedDevice } from "../features/breathalyser";
import { useBreathalyser } from "../context/BreathalyserContext";
import { usePersistentBLE } from "../hooks/usePersistentBLE";
import { getReading } from "../helpers/getReading";

// ─── Helper Components ───────────────────────────────────────────────────────

function FadingErrorBanner({ message }: { message: string }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true, delay: 2500 }),
    ]).start();
  }, [message, opacity]);

  return (
    <Animated.View style={[styles.errorBanner, { opacity }]}>
      <Text style={styles.errorBannerText}>⚠️ {message}</Text>
    </Animated.View>
  );
}

function StatusLed({ status }: { status: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulsing = ["scanning", "connecting", "warmup", "recalibrating"].includes(status);

  useEffect(() => {
    if (pulsing) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.2, duration: 550, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      opacity.setValue(1);
    }
    return () => loopRef.current?.stop();
  }, [pulsing, opacity]);

  const color =
    status === "connected" || status === "ready" ? "#1DB954"
    : status === "warmup"       ? "#FFA500"
    : status === "scanning_bac" || status === "scanning" ? "#1e90ff"
    : status === "recalibrating" ? "#f5a623"
    : "#333";

  return <Animated.View style={[styles.led, { backgroundColor: color, opacity }]} />;
}

function DeviceRow({
  device,
  connectingId,
  onConnect,
}: {
  device: ScannedDevice;
  connectingId: string | null;
  onConnect: () => void;
}) {
  const isLoading = connectingId === device.id;
  return (
    <View style={styles.deviceRow}>
      <View style={styles.deviceRowLeft}>
        <Text style={styles.deviceName}>{device.name || "BlowSafe"}</Text>
        <Text style={styles.deviceId}>{device.id}</Text>
      </View>
      <TouchableOpacity
        style={[styles.btnConnect, isLoading && styles.btnLoading]}
        onPress={onConnect}
        disabled={isLoading}
      >
        {isLoading
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={styles.btnConnectText}>CONNECT</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

function BACCard({ result, onClear }: { result: any; onClear: () => void }) {
  if (!result) return null;
  return (
    <View style={[styles.resultCard, result.overLimit ? styles.resultFail : styles.resultPass]}>
      <Text style={[styles.bacBig, { color: result.overLimit ? "#FF4C4C" : "#1DB954" }]}>
        {result.bacPercent}
      </Text>
      <Text style={styles.bacMg}>{result.bacMg}</Text>
      <Text style={[styles.verdict, { color: result.overLimit ? "#FF4C4C" : "#1DB954" }]}>
        {result.overLimit ? "OVER LIMIT" : "PASS"}
      </Text>
      <TouchableOpacity onPress={onClear} style={styles.clearBtn}>
        <Text style={styles.clearText}>CLEAR</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function BreathalyserScreen() {
  // All hooks at the top — no conditions before them
  const {
    isConnected,
    deviceStatus,
    connectMsg,
    devices,
    setDevices,
    history,
    countdownSeconds,
  } = useBreathalyser();

  const { autoConnectOnMount, handleManualDisconnect } = usePersistentBLE();

  const [scanning, setScanning]           = useState(false);
  const [connectingId, setConnectingId]   = useState<string | null>(null);
  const [connectError, setConnectError]   = useState<string | null>(null);
  const [bleOff, setBleOff]               = useState(false);
  const [readingInProgress, setReadingInProgress] = useState(false);
  const [readingProgress, setReadingProgress]     = useState(0);
  const [readingResult, setReadingResult]         = useState<any>(null);
  const [readingError, setReadingError]           = useState<string | null>(null);

  const progressWidthRef  = useRef(new Animated.Value(0)).current;
  const animationRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef       = useRef(0);
  const hasAutoScanned    = useRef(false);
  const scanActiveRef     = useRef(false);

  // Animate progress bar
  useEffect(() => {
    Animated.timing(progressWidthRef, {
      toValue: readingProgress,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [readingProgress, progressWidthRef]);

  // Clear error when connected
  useEffect(() => {
    if (isConnected) setConnectError(null);
  }, [isConnected]);

  // ─── BLE state + scan results listener ───────────────────────────────────
  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      if (event.type === "ble_state") {
        setBleOff(event.state === State.PoweredOff);
      }
      if (event.type === "scan_result" && !isConnected) {
        const incoming = event.devices[0];
        if (!incoming) return;
        setDevices(prev => {
          if (prev.find(d => d.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
      }
    });
    return unsub;
  }, [isConnected, setDevices]);

  // ─── Permission helper ────────────────────────────────────────────────────
  const requestBluetoothPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== "android") return true;
    try {
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        return (
          granted["android.permission.BLUETOOTH_SCAN"]    === PermissionsAndroid.RESULTS.GRANTED &&
          granted["android.permission.BLUETOOTH_CONNECT"] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (_) {
      return false;
    }
  }, []);

  // ─── Start scan ───────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    if (scanActiveRef.current || isConnected) return;
    const allowed = await requestBluetoothPermission();
    if (!allowed) {
      setConnectError("Bluetooth permission required");
      return;
    }
    scanActiveRef.current = true;
    setDevices([]);
    setScanning(true);
    breathalyser.scan();
  }, [isConnected, requestBluetoothPermission, setDevices]);

  // ─── Auto-scan once on mount if not connected ─────────────────────────────
  useEffect(() => {
    if (!hasAutoScanned.current) {
      hasAutoScanned.current = true;
      // Try auto-reconnect first; if no saved device, fall through to scan
      autoConnectOnMount().catch(() => {
        if (!isConnected) startScan();
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Stop scan once connected ─────────────────────────────────────────────
  useEffect(() => {
    if (isConnected && scanActiveRef.current) {
      scanActiveRef.current = false;
      breathalyser.stopScan();
      setScanning(false);
    }
  }, [isConnected]);

  // ─── Connection watchdog ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(async () => {
      const ok = await breathalyser.isStillConnected();
      if (!ok) breathalyser.emit({ type: "status", status: "disconnected" });
    }, 4000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // ─── Connect to a device ──────────────────────────────────────────────────
  const handleConnect = useCallback(async (device: ScannedDevice) => {
    if (connectingId || isConnected) return;
    setConnectingId(device.id);
    setConnectError(null);
    try {
      await breathalyser.connect(device);
      setConnectingId(null);
    } catch (err: any) {
      setConnectingId(null);
      // Only show timeout to the user; swallow BLE internal errors
      if (err?.message === "Connection timed out") {
        setConnectError("Connection timed out. Move closer and retry.");
      }
    }
  }, [connectingId, isConnected]);

  // ─── Manual scan button ───────────────────────────────────────────────────
  const handleManualScan = useCallback(async () => {
    scanActiveRef.current = false; // reset so startScan can proceed
    await startScan();
  }, [startScan]);

  // ─── Reading ──────────────────────────────────────────────────────────────
  const startReading = useCallback(async () => {
    if (!isConnected || deviceStatus !== "ready" || readingInProgress) return;
    setReadingInProgress(true);
    setReadingProgress(0);
    setReadingError(null);
    progressRef.current = 0;

    animationRef.current = setInterval(() => {
      progressRef.current = Math.min(progressRef.current + 0.15, 96);
      setReadingProgress(progressRef.current);
      if (progressRef.current >= 96) clearInterval(animationRef.current!);
    }, 20);

    try {
      const { bac, timestamp } = await getReading();
      setReadingProgress(100);
      const bacPercent = bac / 10;
      setReadingResult({
        bacPercent: `${bacPercent.toFixed(2)}%`,
        bacMg: `${bac.toFixed(2)} mg/L`,
        overLimit: bacPercent >= 0.05,
        timestamp,
      });
    } catch (err: any) {
      // Only show timeout error
      if (err?.message?.includes("timed out")) {
        setReadingError("Reading timed out. Please try again.");
      }
    } finally {
      if (animationRef.current) clearInterval(animationRef.current);
      setReadingInProgress(false);
    }
  }, [isConnected, deviceStatus, readingInProgress]);

  const clearReadingResult = useCallback(() => {
    setReadingResult(null);
    setReadingProgress(0);
    setReadingError(null);
  }, []);

  // ─── UI helpers ───────────────────────────────────────────────────────────
  const actionText = (() => {
    if (deviceStatus === "warmup") return countdownSeconds > 0 ? `WARMING UP... ${countdownSeconds}s` : "Warming up…";
    if (readingInProgress) return `${Math.round(readingProgress)}%`;
    return "GET READING";
  })();

  const isActionDisabled = !isConnected || deviceStatus !== "ready" || readingInProgress;

  const buttonStyle =
    readingInProgress                                ? styles.btnActive
    : deviceStatus === "warmup" || deviceStatus === "recalibrating" ? styles.btnWarmup
    : styles.btnReady;

  const statusHeaderText = (() => {
    if (deviceStatus === "warmup") return countdownSeconds > 0 ? `Warming up… ${countdownSeconds}s` : "Warming up…";
    if (readingInProgress) return `Reading… ${Math.round(readingProgress)}%`;
    if (readingResult) return `Done • ${readingResult.bacPercent}`;
    if (deviceStatus === "ready") return "Ready to scan";
    return "Connected";
  })();

  const widthInterpolated = progressWidthRef.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  const ledStatus = deviceStatus === "ready" && readingInProgress ? "scanning" : deviceStatus;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {!!connectMsg  && <FadingErrorBanner message={connectMsg} />}
      {!!connectError && <FadingErrorBanner message={connectError} />}
      {!!readingError && <FadingErrorBanner message={readingError} />}

      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.title}>Breathalyser</Text>
        <View style={[styles.pill, isConnected ? styles.pillOn : styles.pillOff]}>
          {isConnected
            ? <Text style={styles.checkmark}>✓</Text>
            : <View style={[styles.pillDot, styles.dotGrey]} />
          }
          <Text style={[styles.pillText, isConnected && { color: "#1DB954" }]}>
            {isConnected ? "Connected" : scanning ? "Scanning…" : "Offline"}
          </Text>
        </View>
      </View>

      {bleOff && (
        <View style={styles.btBanner}>
          <Text style={styles.btBannerText}>Bluetooth is off</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.btBannerBtnText}>OPEN SETTINGS</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {isConnected ? (
          <View style={styles.connectedCard}>
            <View style={styles.statusHeader}>
              <StatusLed status={ledStatus} />
              <Text style={styles.statusText}>{statusHeaderText}</Text>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, buttonStyle]}
                onPress={startReading}
                disabled={isActionDisabled}
              >
                {readingInProgress || deviceStatus === "warmup" ? (
                  <>
                    <View style={styles.progressTrack} />
                    <Animated.View style={[styles.progressFill, { width: widthInterpolated }]} />
                    <Text style={styles.progressText}>{actionText}</Text>
                  </>
                ) : (
                  <Text style={styles.btnText}>{actionText}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.disconnectBtn} onPress={handleManualDisconnect}>
                <Text style={styles.disconnectText}>DISCONNECT</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.scanSection}>
            <TouchableOpacity
              style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
              onPress={handleManualScan}
              disabled={scanning}
            >
              {scanning
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={styles.scanBtnText}>SCAN FOR DEVICES</Text>
              }
            </TouchableOpacity>

            {scanning && (
              <Text style={styles.autoScanIndicator}>🔍 Searching for BlowSafe devices…</Text>
            )}

            {devices.length > 0 && (
              <View style={styles.deviceList}>
                <Text style={styles.sectionLabel}>DEVICES FOUND</Text>
                {devices.map(d => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    connectingId={connectingId}
                    onConnect={() => handleConnect(d)}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {readingResult && <BACCard result={readingResult} onClear={clearReadingResult} />}

        {history?.length > 0 && !readingResult && (
          <View style={styles.historySection}>
            <Text style={styles.sectionLabel}>RECENT READINGS</Text>
            {history.slice(0, 5).map((item, i) => (
              <View key={i} style={styles.historyRow}>
                <Text style={[styles.historyBac, { color: item.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                  {item.bacPercent}
                </Text>
                <Text style={styles.historyTime}>
                  {new Date(item.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#121212" },

  errorBanner: {
    position: "absolute", top: 10, left: 16, right: 16, zIndex: 20, elevation: 10,
    backgroundColor: "rgba(255,76,76,0.93)", borderRadius: 10, padding: 12,
  },
  errorBannerText: { color: "#fff", textAlign: "center", fontWeight: "600", fontSize: 13 },

  topBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)",
  },
  title: { color: "#1DB954", fontSize: 16, fontWeight: "800" },

  pill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1,
  },
  pillOn:  { borderColor: "rgba(29,185,84,0.3)", backgroundColor: "rgba(29,185,84,0.08)" },
  pillOff: { borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.03)" },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  dotGrey: { backgroundColor: "#444" },
  checkmark: { color: "#1DB954", fontSize: 12, fontWeight: "bold" },
  pillText: { fontSize: 10, fontWeight: "600", color: "#888" },

  btBanner: {
    flexDirection: "row", justifyContent: "space-between", padding: 10,
    backgroundColor: "rgba(255,76,76,0.08)",
  },
  btBannerText: { color: "#aaa", fontWeight: "600" },
  btBannerBtnText: { color: "#FF4C4C", fontWeight: "800" },

  content: { padding: 16, paddingBottom: 48 },

  connectedCard: {
    backgroundColor: "#1a1a1a", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", gap: 14, marginBottom: 16,
  },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  led: { width: 12, height: 12, borderRadius: 6 },

  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1.5, height: 50, borderRadius: 25, overflow: "hidden",
    justifyContent: "center", alignItems: "center",
  },
  btnWarmup: { backgroundColor: "#FFA500" },
  btnReady:  { backgroundColor: "#1DB954" },
  btnActive: { backgroundColor: "#1e90ff" },
  btnText: { color: "#000", fontWeight: "800", fontSize: 14 },

  progressTrack: {
    position: "absolute", inset: 0,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  progressFill: {
    position: "absolute", left: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  progressText: { color: "#fff", fontWeight: "800", fontSize: 15, zIndex: 2 },

  disconnectBtn: {
    flex: 1, backgroundColor: "#2a2a2a", height: 50, borderRadius: 25,
    justifyContent: "center", alignItems: "center",
  },
  disconnectText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  scanSection: { gap: 14 },
  scanBtn: {
    backgroundColor: "#1DB954", height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center",
  },
  scanBtnDisabled: { opacity: 0.55 },
  scanBtnText: { color: "#000", fontWeight: "800", fontSize: 14 },
  autoScanIndicator: { color: "#555", fontSize: 12, textAlign: "center", fontStyle: "italic" },

  deviceList: { gap: 8 },
  sectionLabel: { color: "#555", fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },

  deviceRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#111", borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  deviceRowLeft: { flex: 1 },
  deviceName: { color: "#fff", fontWeight: "600", fontSize: 14 },
  deviceId: { color: "#444", fontSize: 10, marginTop: 3 },

  btnConnect: {
    backgroundColor: "#1DB954", paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20, minWidth: 80, alignItems: "center",
  },
  btnLoading: { backgroundColor: "#333" },
  btnConnectText: { color: "#000", fontWeight: "800", fontSize: 12 },

  resultCard: {
    padding: 24, alignItems: "center", borderRadius: 14,
    borderWidth: 1, marginBottom: 16,
  },
  resultFail: { backgroundColor: "rgba(255,76,76,0.08)", borderColor: "#FF4C4C" },
  resultPass: { backgroundColor: "rgba(29,185,84,0.08)", borderColor: "#1DB954" },
  bacBig: { fontSize: 52, fontWeight: "bold" },
  bacMg: { color: "#aaa", fontSize: 13, marginTop: 4 },
  verdict: { fontSize: 13, fontWeight: "800", letterSpacing: 2, marginTop: 8 },
  clearBtn: { marginTop: 16, padding: 8 },
  clearText: { color: "#444", fontSize: 12, fontWeight: "600" },

  historySection: { marginTop: 8 },
  historyRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1a1a1a",
  },
  historyBac: { fontWeight: "600", fontSize: 14 },
  historyTime: { color: "#555", fontSize: 12 },
});