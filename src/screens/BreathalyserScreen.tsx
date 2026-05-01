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
  const opacityRef = useRef(new Animated.Value(0));
  useEffect(() => {
    opacityRef.current.setValue(0);
    Animated.sequence([
      Animated.timing(opacityRef.current, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(opacityRef.current, { toValue: 0, duration: 400, useNativeDriver: true, delay: 2000 }),
    ]).start();
  }, [message]);
  return (
    <Animated.View style={[styles.errorBanner, { opacity: opacityRef.current }]}>
      <Text style={styles.errorBannerText}>⚠️ {message}</Text>
    </Animated.View>
  );
}

function StatusLed({ status }: { status: string }) {
  const opacityRef = useRef(new Animated.Value(1));
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulsing = ["scanning", "connecting", "warmup", "recalibrating"].includes(status);
  useEffect(() => {
    if (pulsing) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacityRef.current, { toValue: 0.25, duration: 550, useNativeDriver: true }),
          Animated.timing(opacityRef.current, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      opacityRef.current.setValue(1);
    }
    return () => { loopRef.current?.stop(); };
  }, [pulsing]);
  const color =
    status === "ready" ? "#1DB954"
    : status === "warmup" ? "#FFA500"
    : status === "scanning" ? "#1e90ff"
    : status === "recalibrating" ? "#f5a623"
    : "#333";
  return <Animated.View style={[styles.led, { backgroundColor: color, opacity: opacityRef.current }]} />;
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
        {isLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.btnConnectText}>CONNECT</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function BACCard({ result, onClear }: { result: any; onClear: () => void }) {
  if (!result) return null;
  return (
    <View
      style={[
        styles.resultCard,
        result.overLimit ? styles.resultFail : styles.resultPass,
      ]}
    >
      <Text style={styles.bacBig}>{result.bacPercent}%</Text>
      <Text style={styles.bacMg}>{result.bacMg}</Text>
      <TouchableOpacity onPress={onClear}>
        <Text style={styles.clearText}>CLEAR</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function BreathalyserScreen() {
  // ✅ Only the values that exist in your context
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

  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [bleOff, setBleOff] = useState(false);

  // ─── Reading state managed locally ───────────
  const [readingInProgress, setReadingInProgress] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [readingResult, setReadingResult] = useState<any>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef(0);
  const progressWidthRef = useRef(new Animated.Value(0));

  // Smooth progress bar animation
  useEffect(() => {
    Animated.timing(progressWidthRef.current, {
      toValue: readingProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [readingProgress]);

  // ─── Bluetooth permissions ─────────────────────
  const requestBluetoothPermission = async (): Promise<boolean> => {
    if (Platform.OS === "ios") return true;
    if (Platform.OS === "android" && Platform.Version >= 23) {
      try {
        const permissions: string[] = [];
        if (Platform.Version >= 31) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
          );
        } else {
          permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        }
        const granted = await PermissionsAndroid.requestMultiple(permissions as any[]);
        if (Platform.Version >= 31) {
          return (
            granted["android.permission.BLUETOOTH_SCAN"] === PermissionsAndroid.RESULTS.GRANTED &&
            granted["android.permission.BLUETOOTH_CONNECT"] === PermissionsAndroid.RESULTS.GRANTED
          );
        } else {
          return (
            granted["android.permission.ACCESS_FINE_LOCATION"] === PermissionsAndroid.RESULTS.GRANTED
          );
        }
      } catch (err) {
        console.warn(err);
        return false;
      }
    }
    return true;
  };

  // ─── Scan lifecycle with permission guard ──────
  
  const isScanningRef = useRef(false);
  useEffect(() => {
    const startScanIfAllowed = async () => {
      if (!isConnected) {
        const allowed = await requestBluetoothPermission();
        if (!allowed) {
          setScanning(false);
          return;
        }
        if (!isScanningRef.current) {
          isScanningRef.current = true;
          setDevices([]);
          setScanning(true);
          breathalyser.scan();
        }
      } else {
        isScanningRef.current = false;
        breathalyser.stopScan();
        setScanning(false);
      }
    };
    startScanIfAllowed();
    return () => {
      if (isScanningRef.current) {
        breathalyser.stopScan();
        isScanningRef.current = false;
      }
    };
  }, [isConnected, setDevices]);

  // Connection watchdog
  useEffect(() => {
    let interval: any;
    if (isConnected) {
      interval = setInterval(async () => {
        const ok = await breathalyser.isStillConnected();
        if (!ok) {
          breathalyser.emit({ type: "status", status: "disconnected" });
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  // BLE state monitor
  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      if (event.type === "ble_state") setBleOff(event.state === State.PoweredOff);
      if (event.type === "scan_result" && !isConnected) {
        const newDevice = event.devices[0];
        setDevices((prev) => {
          if (prev.find((d) => d.id === newDevice.id)) return prev;
          return [...prev, newDevice];
        });
      }
    });
    return unsub;
  }, [isConnected, setDevices]);

  // Auto-connect on mount
  useEffect(() => {
    autoConnectOnMount();
  }, [autoConnectOnMount]);

  // ✅ Clear any connection error once the device actually connects
  useEffect(() => {
    if (isConnected) {
      setConnectError(null);
    }
  }, [isConnected]);

  // ✅ handleConnect with longer timeout + ignore error if connected afterwards
  const handleConnect = useCallback(
    async (device: ScannedDevice) => {
      if (connectingId || isConnected) return;
      setConnectingId(device.id);
      setConnectError(null);
      try {
        await breathalyser.stopScan();
        await Promise.race([
          breathalyser.connect(device),
          new Promise((_, r) => setTimeout(() => r(new Error("Timed out")), 15000)), // 15 seconds
        ]);
        setConnectingId(null);
      } catch (e: any) {
        setConnectingId(null);
        // If the device actually managed to connect despite the timeout, don't show error
        const stillConnected = await breathalyser.isStillConnected();
        if (!stillConnected) {
          setConnectError(e.message);
        }
      }
    },
    [connectingId, isConnected]
  );

  // ─── Reading logic ──────────────────────────────
  const startReading = async () => {
    if (!isConnected || deviceStatus !== "ready" || readingInProgress) return;
    setReadingInProgress(true);
    setReadingProgress(0);
    setReadingError(null);
    progressRef.current = 0;

    // Animate 0% → 98% over ~20 seconds
    animationRef.current = setInterval(() => {
      progressRef.current = Math.min(progressRef.current + 0.1, 98);
      setReadingProgress(progressRef.current);
      if (progressRef.current >= 98) {
        clearInterval(animationRef.current!);
      }
    }, 20);

    try {
      const { bac, timestamp } = await getReading();
      // Jump to 100% and display result
      setReadingProgress(100);
      const bacPercent = bac / 10; // 0.50 → 0.05%
      const overLimit = bacPercent >= 0.05;
      setReadingResult({
        bacPercent: `${bacPercent.toFixed(2)}%`,
        bacMg: `${bac.toFixed(2)} mg/L`,
        overLimit,
        timestamp,
      });
    } catch (err: any) {
      setReadingError(err.message);
    } finally {
      clearInterval(animationRef.current!);
      setReadingInProgress(false);
    }
  };

  const clearReadingResult = () => {
    setReadingResult(null);
    setReadingProgress(0);
    setReadingError(null);
  };

  // ─── UI helpers ─────────────────────────────────
  const getActionText = () => {
    if (deviceStatus === "warmup") {
      return countdownSeconds > 0
        ? `GETTING READY... ${countdownSeconds}s`
        : "Warming up…";
    }
    if (readingInProgress) return `${Math.round(readingProgress)}%`;
    return "GET READING";
  };

  const isActionDisabled = () => {
    if (!isConnected) return true;
    if (deviceStatus === "ready" && !readingInProgress) return false;
    return true;
  };

  const widthStyle = progressWidthRef.current.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  const getButtonStyle = () => {
    if (readingInProgress) return styles.btnActive;
    if (deviceStatus === "warmup" || deviceStatus === "recalibrating")
      return styles.btnWarmup;
    return styles.btnReady;
  };

  const statusHeaderText = () => {
    if (deviceStatus === "warmup") {
      return countdownSeconds > 0
        ? `Getting ready... ${countdownSeconds}s`
        : "Warming up…";
    }
    if (readingInProgress) return `Reading... ${Math.round(readingProgress)}%`;
    if (readingResult) return `Ready • ${readingResult.bacPercent}`;
    return "Ready to scan";
  };

  const handleManualScan = async () => {
    const allowed = await requestBluetoothPermission();
    if (!allowed) {
      setConnectError("Bluetooth permission required");
      return;
    }
    setDevices([]);
    setScanning(true);
    breathalyser.scan();
  };

  // ─── Render ──────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {connectMsg && <FadingErrorBanner message={connectMsg} />}
      {connectError && <FadingErrorBanner message={connectError} />}
      {readingError && <FadingErrorBanner message={readingError} />}

      <View style={styles.topBar}>
        <Text style={styles.title}>Breathalyser</Text>
        <View style={[styles.pill, isConnected ? styles.pillOn : styles.pillOff]}>
          {isConnected ? (
            <Text style={styles.checkmark}>✓</Text>
          ) : (
            <View style={[styles.pillDot, styles.dotGrey]} />
          )}
          <Text style={[styles.pillText, isConnected && { color: "#1DB954" }]}>
            {isConnected ? "Connected" : "Offline"}
          </Text>
        </View>
      </View>

      {bleOff && (
        <View style={styles.btBanner}>
          <Text style={styles.btBannerText}>Bluetooth Off</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.btBannerBtnText}>OPEN SETTINGS</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {isConnected ? (
          <View style={styles.connectedCard}>
            <View style={styles.statusHeader}>
              <StatusLed
                status={
                  deviceStatus === "ready" && readingInProgress
                    ? "scanning"
                    : deviceStatus
                }
              />
              <Text style={styles.statusText}>{statusHeaderText()}</Text>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, getButtonStyle()]}
                onPress={startReading}
                disabled={isActionDisabled()}
              >
                {readingInProgress || deviceStatus === "warmup" ? (
                  <>
                    <View style={styles.progressTrack} />
                    <Animated.View style={[styles.progressFill, { width: widthStyle }]} />
                    <Text style={styles.progressText}>{getActionText()}</Text>
                  </>
                ) : (
                  <Text style={styles.btnText}>{getActionText()}</Text>
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
              <Text style={styles.scanBtnText}>
                {scanning ? "REFRESH..." : "SCAN FOR DEVICES"}
              </Text>
            </TouchableOpacity>
            {scanning && !isConnected && (
              <Text style={styles.autoScanIndicator}>🔍 Auto-scanning...</Text>
            )}
            {devices.length > 0 && (
              <View style={styles.deviceList}>
                <Text style={styles.sectionLabel}>DEVICES FOUND</Text>
                {devices.map((d) => (
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
            {history.slice(0, 3).map((item, i) => (
              <View key={i} style={styles.historyRow}>
                <Text style={styles.historyBac}>{item.bacPercent}%</Text>
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
    position: "absolute",
    top: 10,
    left: 16,
    right: 16,
    backgroundColor: "rgba(255,76,76,0.9)",
    borderRadius: 8,
    padding: 12,
    zIndex: 10,
    elevation: 5,
  },
  errorBannerText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "600",
    fontSize: 13,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  title: { color: "#1DB954", fontSize: 16, fontWeight: "800" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  pillOn: {
    borderColor: "rgba(29,185,84,0.3)",
    backgroundColor: "rgba(29,185,84,0.08)",
  },
  pillOff: {
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  dotGreen: { backgroundColor: "#1DB954" },
  dotGrey: { backgroundColor: "#444" },
  checkmark: { color: "#1DB954", fontSize: 12, fontWeight: "bold", marginRight: 2 },
  pillText: { fontSize: 10, fontWeight: "600", color: "#fff" },
  btBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 10,
    backgroundColor: "rgba(255,76,76,0.1)",
  },
  btBannerText: { color: "#16c00d", fontWeight: "600" },
  btBannerBtnText: { color: "#FF4C4C", fontWeight: "800" },
  content: { padding: 16, paddingBottom: 40 },
  connectedCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    gap: 12,
    marginBottom: 16,
  },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  statusText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  led: { width: 12, height: 12, borderRadius: 6 },
  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1.5,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  btnWarmup: { backgroundColor: "#FFA500" },
  btnReady: { backgroundColor: "#1DB954" },
  btnActive: { backgroundColor: "#1e90ff" },
  btnText: { color: "#000", fontWeight: "800", fontSize: 14, zIndex: 2 },
  progressTrack: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  progressText: { color: "#fff", fontWeight: "800", fontSize: 15, zIndex: 2 },
  disconnectBtn: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  disconnectText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  scanSection: { gap: 12 },
  scanBtn: {
    backgroundColor: "#1DB954",
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  scanBtnDisabled: { opacity: 0.5 },
  scanBtnText: { color: "#000", fontWeight: "800", fontSize: 14 },
  autoScanIndicator: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
    fontStyle: "italic",
  },
  deviceList: { gap: 8 },
  sectionLabel: {
    color: "#666",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 6,
    letterSpacing: 1,
  },
  deviceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1e1e1e",
  },
  deviceRowLeft: { flex: 1 },
  deviceName: { color: "#fff", fontWeight: "600", fontSize: 14 },
  deviceId: { color: "#555", fontSize: 10, marginTop: 4 },
  btnConnect: {
    backgroundColor: "#1DB954",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 80,
    alignItems: "center",
  },
  btnLoading: { backgroundColor: "#555" },
  btnConnectText: { color: "#000", fontWeight: "800", fontSize: 12 },
  resultCard: { padding: 20, alignItems: "center", borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  resultFail: { backgroundColor: "rgba(255,76,76,0.1)", borderColor: "#FF4C4C" },
  resultPass: { backgroundColor: "rgba(29,185,84,0.1)", borderColor: "#1DB954" },
  bacBig: { fontSize: 44, fontWeight: "bold", color: "#fff" },
  bacMg: { color: "#aaa", fontSize: 12, marginBottom: 10 },
  clearText: { color: "#666", fontSize: 12, fontWeight: "600" },
  historySection: { marginTop: 8 },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e1e",
  },
  historyBac: { color: "#fff", fontWeight: "600" },
  historyTime: { color: "#555", fontSize: 12 },
});