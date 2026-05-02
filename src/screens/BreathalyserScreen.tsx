/**
 * src/screens/BreathalyserScreen.tsx
 *
 * Breathalyser screen — pairs with Arduino R4 over BLE.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { State } from "react-native-ble-plx";
import { breathalyser, ScannedDevice } from "../features/breathalyser";
import { useBreathalyser } from "../context/BreathalyserContext";
import { usePersistentBLE } from "../hooks/usePersistentBLE";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ScreenPhase =
  | "disconnected"
  | "scanning_devices"
  | "connecting"
  | "warmup"
  | "ready"
  | "scanning_bac"
  | "result";

interface BacResult {
  bac: number;
  overLimit: boolean;
  timestamp: number;
}

const BAC_LEGAL_LIMIT = 0.08; // Zimbabwe Road Traffic Act

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ToastBanner({ message }: { message: string }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true, delay: 2800 }),
    ]).start();
  }, [message]);

  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

function PulseDot({
  color,
  pulse,
}: {
  color: string;
  pulse: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    loopRef.current?.stop();
    if (pulse) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.5, duration: 500, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    } else {
      scale.setValue(1);
    }
    return () => loopRef.current?.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: color, transform: [{ scale }] },
      ]}
    />
  );
}

function DeviceCard({
  device,
  connecting,
  onConnect,
}: {
  device: ScannedDevice;
  connecting: boolean;
  onConnect: () => void;
}) {
  return (
    <View style={styles.deviceCard}>
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{device.name || "BlowSafe Device"}</Text>
        <Text style={styles.deviceId} numberOfLines={1}>{device.id}</Text>
      </View>
      <TouchableOpacity
        style={[styles.connectBtn, connecting && styles.connectBtnBusy]}
        onPress={onConnect}
        disabled={connecting}
        activeOpacity={0.75}
      >
        {connecting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.connectBtnText}>CONNECT</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function WarmupRing({ remaining }: { remaining: number }) {
  const total = 30;
  const progress = Math.max(0, Math.min(1, remaining / total));
  
  // Color Thresholds:
  // Green: 30–11s remaining
  // Yellow: 10–6s remaining
  // Red: 5–0s remaining
  let ringColor = "#1DB954"; // Green default
  if (remaining <= 5) {
    ringColor = "#FF4C4C"; // Red
  } else if (remaining <= 10) {
    ringColor = "#FFA500"; // Yellow/Orange
  }

  return (
    <View style={styles.ringContainer}>
      <View style={styles.ringSvgWrap}>
        {/* Background ring */}
        <View style={[styles.ringTrack, { borderColor: "rgba(255,255,255,0.06)" }]} />
        
        {/* Progress ring - Simulated with border rotation */}
        <View
          style={[
            styles.ringProgress,
            {
              borderColor: ringColor,
              transform: [{ rotate: `${-90 + (1 - progress) * 360}deg` }],
              opacity: progress > 0 ? 1 : 0,
            },
          ]}
        />
        
        <View style={styles.ringCenter}>
          <Text style={[styles.ringNumber, { color: ringColor }]}>{remaining}</Text>
          <Text style={styles.ringLabel}>seconds</Text>
        </View>
      </View>
      <Text style={styles.warmupTitle}>Warming Up</Text>
      <Text style={styles.warmupSub}>Device is calibrating its sensor. Please wait.</Text>
    </View>
  );
}

function BacResultCard({
  result,
  onClear,
}: {
  result: BacResult;
  onClear: () => void;
}) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
      Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);

  const pass = !result.overLimit;
  const accentColor = pass ? "#1DB954" : "#FF4C4C";
  const bacPercent = (result.bac * 100).toFixed(2);
  const bacMg = (result.bac * 1000).toFixed(0);

  return (
    <Animated.View style={[styles.resultCard, { opacity, transform: [{ scale }], borderColor: accentColor }]}>
      <View style={[styles.resultBadge, { backgroundColor: pass ? "rgba(29,185,84,0.12)" : "rgba(255,76,76,0.12)" }]}>
        <Text style={[styles.resultVerdict, { color: accentColor }]}>
          {pass ? "✓  PASS" : "✗  OVER LIMIT"}
        </Text>
      </View>

      <Text style={[styles.resultBac, { color: accentColor }]}>{bacPercent}%</Text>
      <Text style={styles.resultBacMg}>{bacMg} mg/100ml</Text>

      <View style={styles.resultMeta}>
        <View style={styles.resultMetaItem}>
          <Text style={styles.resultMetaLabel}>Legal limit</Text>
          <Text style={styles.resultMetaValue}>0.08%</Text>
        </View>
        <View style={styles.resultMetaDivider} />
        <View style={styles.resultMetaItem}>
          <Text style={styles.resultMetaLabel}>Tested at</Text>
          <Text style={styles.resultMetaValue}>
            {new Date(result.timestamp).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.clearBtn} onPress={onClear} activeOpacity={0.7}>
        <Text style={styles.clearBtnText}>NEW TEST</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function BreathalyserScreen() {
  const { devices, setDevices } = useBreathalyser();
  const { autoConnectOnMount, handleManualDisconnect } = usePersistentBLE();

  // Core state
  const [phase, setPhase] = useState<ScreenPhase>("disconnected");
  const [warmupRemaining, setWarmupRemaining] = useState(30);
  const [foundDevices, setFoundDevices] = useState<ScannedDevice[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [result, setResult] = useState<BacResult | null>(null);
  const [history, setHistory] = useState<BacResult[]>([]);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastKey = useRef(0);

  // BLE state
  const [bleOff, setBleOff] = useState(false);

  // Scan state
  const scanActiveRef = useRef(false);
  const hasAutoAttemptedRef = useRef(false);
  const autoReadTriggeredRef = useRef(false); // 🔧 Track if auto-read was triggered

  // Reading progress animation
  const scanProgress = useRef(new Animated.Value(0)).current;
  const scanAnim = useRef<Animated.CompositeAnimation | null>(null);

  // ─── Toast helper ───────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    toastKey.current += 1;
    setToast(msg);
  }, []);

  // ─── BLE event listener ─────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      // BLE adapter state
      if (event.type === "ble_state") {
        setBleOff(event.state === State.PoweredOff);
        return;
      }

      // Device scan results
      if (event.type === "scan_result") {
        const incoming = event.devices[0];
        if (!incoming) return;
        
        // Add device if not already in list
        setFoundDevices((prev) => {
          if (prev.find((d) => d.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
        return;
      }

      // Connection status
      if (event.type === "status") {
        if (event.status === "connected") {
          scanActiveRef.current = false;
          setConnectingId(null); // Clear connecting state
          showToast("✓ Connected");
          
          // 🔧 Auto-trigger reading after successful connection
          // We wait a tiny bit to ensure state updates, then trigger
          setTimeout(() => {
            if (!autoReadTriggeredRef.current) {
              autoReadTriggeredRef.current = true;
              // We can't call handleStartReading directly here because it depends on 'phase'
              // Instead, we let the Arduino send STATUS:READY, which sets phase to 'ready'
              // Then we trigger the read.
            }
          }, 500);
          return;
        }
        if (event.status === "disconnected") {
          stopScanAnim();
          setPhase("disconnected");
          setResult(null);
          setConnectingId(null);
          setFoundDevices([]);
          autoReadTriggeredRef.current = false; // Reset flag
          showToast("Device disconnected");
          return;
        }
        return;
      }

      // Data from Arduino
      if (event.type === "reading") {
        handleArduinoMessage(event.value.trim());
      }
    });

    return unsub;
  }, []);

  // ─── Arduino message handler ────────────────────────────────────────────────

  const handleArduinoMessage = useCallback((msg: string) => {
    if (!msg) return;

    // WARMUP countdown
    if (msg.startsWith("STATUS:WARMUP:")) {
      const seconds = parseInt(msg.slice(14), 10);
      if (!isNaN(seconds)) {
        setWarmupRemaining(seconds);
        setPhase("warmup");
      }
      return;
    }

    // Device ready
    if (msg === "STATUS:READY") {
      setPhase("ready");
      setWarmupRemaining(0);
      
      // 🔧 Trigger auto-read if this is the first time becoming ready after connect
      if (autoReadTriggeredRef.current) {
        autoReadTriggeredRef.current = false; // Consume the trigger
        // Small delay to ensure UI has updated to 'ready' phase
        setTimeout(() => {
          handleStartReading();
        }, 500);
      }
      return;
    }

    // Scan in progress (Arduino acknowledged SCAN command)
    if (msg === "STATUS:SCANNING") {
      // Keep animation running - UI already started it
      return;
    }

    // BAC result
    if (msg.startsWith("BAC:")) {
      stopScanAnim();
      const raw = msg.slice(4);
      const bac = parseFloat(raw);
      if (isNaN(bac) || bac < 0) {
        showToast("Device returned an invalid reading. Please try again.");
        setPhase("ready");
        return;
      }
      const newResult: BacResult = {
        bac,
        overLimit: bac >= BAC_LEGAL_LIMIT,
        timestamp: Date.now(),
      };
      setResult(newResult);
      setHistory((prev) => [newResult, ...prev.slice(0, 19)]);
      setPhase("result");
      return;
    }
  }, []);

  // ─── Scan animation ─────────────────────────────────────────────────────────

  const startScanAnim = useCallback(() => {
    scanProgress.setValue(0);
    // Run from 0 → 95% over 20s (matches Arduino scan duration)
    // The final 5% fills when the BAC result arrives
    scanAnim.current = Animated.timing(scanProgress, {
      toValue: 0.95,
      duration: 20_000,
      useNativeDriver: false,
    });
    scanAnim.current.start();
  }, []);

  const stopScanAnim = useCallback(() => {
    scanAnim.current?.stop();
    scanAnim.current = null;
    Animated.timing(scanProgress, {
      toValue: 1,
      duration: 300,
      useNativeDriver: false,
    }).start(() => {
      setTimeout(() => scanProgress.setValue(0), 800);
    });
  }, []);

  // ─── Permissions ────────────────────────────────────────────────────────────

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== "android") return true;
    try {
      if (Platform.Version >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        
        // 🔧 FIX #5: Warn about Location requirement for scanning
        const locationEnabled = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        if (!locationEnabled) {
          showToast("Turn on Location for Bluetooth scanning");
        }

        return (
          result["android.permission.BLUETOOTH_SCAN"] === PermissionsAndroid.RESULTS.GRANTED &&
          result["android.permission.BLUETOOTH_CONNECT"] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn("Permission error:", err);
      return false;
    }
  }, []);

  // ─── Device scan ─────────────────────────────────────────────────────────────

  const startDeviceScan = useCallback(async () => {
    if (scanActiveRef.current) return;
    
    const allowed = await requestPermissions();
    if (!allowed) {
      showToast("Bluetooth permission is required to scan.");
      return;
    }

    // Reset state before scanning
    scanActiveRef.current = true;
    hasAutoAttemptedRef.current = true; // 🔧 FIX #8: Prevent auto-reconnect race
    setFoundDevices([]);
    setPhase("scanning_devices");
    
    // Start the scan
    try {
      breathalyser.scan();
    } catch (e) {
      console.error("Scan failed to start", e);
      scanActiveRef.current = false;
      setPhase("disconnected");
      showToast("Failed to start scan.");
    }

    // Auto-stop scan UI after 10s if no device found
    setTimeout(() => {
      if (scanActiveRef.current) {
        scanActiveRef.current = false;
        setPhase((prev) => (prev === "scanning_devices" ? "disconnected" : prev));
      }
    }, 10_000);
  }, [requestPermissions, showToast]);

  // ─── Auto-connect on mount ───────────────────────────────────────────────────

  useEffect(() => {
    if (hasAutoAttemptedRef.current) return;
    hasAutoAttemptedRef.current = true;

    // Disabled auto-connect as per request
    // autoConnectOnMount().catch(() => {
    //   startDeviceScan();
    // });
  }, []);

  // ─── Connect to a device ──────────────────────────────────────────────────────

  const handleConnect = useCallback(
    async (device: ScannedDevice) => {
      if (connectingId) return;
      setConnectingId(device.id);
      showToast("Connecting..."); // 🔧 Feedback
      
      try {
        await breathalyser.stopScan(); // 🔧 FIX #1: Stop scan before connect
        await breathalyser.connect(device);
        // Phase transition and auto-read are handled in the BLE listener
      } catch (err: any) {
        setConnectingId(null);
        if (err?.message === "Connection timed out") {
          showToast("Sorry, couldn't connect. Try again.");
        } else {
          showToast("Connection failed.");
        }
      }
    },
    [connectingId, showToast]
  );

  // ─── Trigger reading ─────────────────────────────────────────────────────────
  // 🔧 UPDATED: Direct sendCommand with instant UI feedback and proper error handling

  const handleStartReading = useCallback(async () => {
    if (phase !== "ready") return;
    
    // 1. INSTANT FEEDBACK: Update UI immediately before any BLE call
    setPhase("scanning_bac");
    startScanAnim();

    try {
      // 2. Send SCAN command directly
      await breathalyser.sendCommand("SCAN");
      
    } catch (err: any) {
      // Revert UI if command fails
      stopScanAnim();
      setPhase("ready");
      
      // Show specific error based on what failed
      if (err?.message === 'DEVICE_NOT_CONNECTED') {
        showToast("Device disconnected. Please reconnect.");
        setPhase("disconnected");
      } else if (err?.message === 'COMMAND_SEND_FAILED') {
        showToast("Failed to send command. Ensure device is ready and try again.");
      } else {
        showToast("An unexpected error occurred. Please try again.");
      }
    }
  }, [phase, startScanAnim, stopScanAnim, showToast]);

  // ─── Disconnect ──────────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(async () => {
    stopScanAnim();
    await handleManualDisconnect();
  }, [handleManualDisconnect, stopScanAnim]);

  // ─── Clear result ────────────────────────────────────────────────────────────

  const handleClearResult = useCallback(() => {
    setResult(null);
    setPhase("ready");
  }, []);

  // ─── Derived UI values ───────────────────────────────────────────────────────

  const isConnected = !["disconnected", "scanning_devices", "connecting"].includes(phase);

  const dotColor = (() => {
    if (phase === "warmup") {
        // Sync header dot with warmup ring logic
        if (warmupRemaining <= 5) return "#FF4C4C";
        if (warmupRemaining <= 10) return "#FFA500";
        return "#1DB954";
    }
    if (phase === "ready" || phase === "result") return "#1DB954";
    if (phase === "scanning_bac") return "#3B8BEB";
    return "#555";
  })();

  const dotPulse = phase === "warmup" || phase === "scanning_bac";

  const statusLabel = (() => {
    if (phase === "warmup") return `Warming up • ${warmupRemaining}s`;
    if (phase === "ready") return "Ready to test";
    if (phase === "scanning_bac") return "Analysing breath…";
    if (phase === "result") return result?.overLimit ? "Over legal limit" : "Within legal limit";
    return "";
  })();

  const barWidth = scanProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Toast */}
      {toast && <ToastBanner key={toastKey.current} message={toast} />}

      {/* Top bar */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Breathalyser</Text>
        {isConnected && (
          <View style={styles.headerStatus}>
            <PulseDot color={dotColor} pulse={dotPulse} />
            <Text style={[styles.headerStatusText, { color: dotColor }]}>{statusLabel}</Text>
          </View>
        )}
      </View>

      {/* Bluetooth off banner */}
      {bleOff && (
        <TouchableOpacity style={styles.btOffBanner} onPress={() => Linking.openSettings()}>
          <Text style={styles.btOffText}>⚠  Bluetooth is off</Text>
          <Text style={styles.btOffAction}>Open Settings</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── DISCONNECTED / SCANNING / CONNECTING ──────────────────────────── */}
        {(phase === "disconnected" || phase === "scanning_devices" || phase === "connecting") && (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.scanButton, phase === "scanning_devices" && styles.scanButtonBusy]}
              onPress={startDeviceScan}
              disabled={phase === "scanning_devices"}
              activeOpacity={0.8}
            >
              {phase === "scanning_devices" ? (
                <>
                  <ActivityIndicator color="#000" size="small" style={{ marginRight: 8 }} />
                  <Text style={styles.scanButtonText}>Scanning…</Text>
                </>
              ) : (
                <Text style={styles.scanButtonText}>SCAN FOR DEVICES</Text>
              )}
            </TouchableOpacity>

            {phase === "scanning_devices" && (
              <Text style={styles.scanHint}>Looking for BlowSafe devices nearby…</Text>
            )}

            {foundDevices.length > 0 && (
              <View style={styles.deviceList}>
                <Text style={styles.sectionLabel}>FOUND DEVICES</Text>
                {foundDevices.map((d) => (
                  <DeviceCard
                    key={d.id}
                    device={d}
                    connecting={connectingId === d.id}
                    onConnect={() => handleConnect(d)}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── WARMUP ───────────────────────────────────────────────────────── */}
        {phase === "warmup" && (
          <View style={styles.section}>
            <WarmupRing remaining={warmupRemaining} />
            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} activeOpacity={0.7}>
              <Text style={styles.disconnectBtnText}>DISCONNECT</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── READY ────────────────────────────────────────────────────────── */}
        {phase === "ready" && (
          <View style={styles.section}>
            <View style={styles.readyCard}>
              <View style={styles.readyIconWrap}>
                <Text style={styles.readyIcon}>◉</Text>
              </View>
              <Text style={styles.readyTitle}>Device Ready</Text>
              <Text style={styles.readySub}>Press the button below and blow into the device when prompted.</Text>

              <TouchableOpacity
                style={styles.readyBtn}
                onPress={handleStartReading}
                disabled={phase !== 'ready'}
                activeOpacity={0.8}
              >
                <Text style={styles.readyBtnText}>START TEST</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} activeOpacity={0.7}>
              <Text style={styles.disconnectBtnText}>DISCONNECT</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── SCANNING BAC ─────────────────────────────────────────────────── */}
        {phase === "scanning_bac" && (
          <View style={styles.section}>
            <View style={styles.scanningCard}>
              <Text style={styles.scanningTitle}>Analysing…</Text>
              <Text style={styles.scanningSub}>Keep blowing steadily into the device.</Text>

              <View style={styles.progressTrack}>
                <Animated.View style={[styles.progressFill, { width: barWidth }]} />
              </View>

              <Text style={styles.scanningNote}>This takes approximately 20 seconds.</Text>
            </View>
          </View>
        )}

        {/* ── RESULT ───────────────────────────────────────────────────────── */}
        {phase === "result" && result && (
          <View style={styles.section}>
            <BacResultCard result={result} onClear={handleClearResult} />
            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} activeOpacity={0.7}>
              <Text style={styles.disconnectBtnText}>DISCONNECT</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── HISTORY ──────────────────────────────────────────────────────── */}
        {history.length > 0 && phase !== "result" && (
          <View style={styles.historySection}>
            <Text style={styles.sectionLabel}>RECENT TESTS</Text>
            {history.slice(0, 8).map((item, i) => (
              <View key={i} style={styles.historyRow}>
                <View style={[styles.historyDot, { backgroundColor: item.overLimit ? "#FF4C4C" : "#1DB954" }]} />
                <Text style={[styles.historyBac, { color: item.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                  {(item.bac * 100).toFixed(2)}%
                </Text>
                <Text style={styles.historyTime}>
                  {new Date(item.timestamp).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Text style={[styles.historyVerdict, { color: item.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                  {item.overLimit ? "OVER" : "PASS"}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.legalNote}>
          Zimbabwe limit: 0.08% BAC (80 mg/100ml) · Road Traffic Act
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0c0c0c",
  },

  // ── Toast ─────────────────────────────────────────────────────────────────
  toast: {
    position: "absolute",
    top: 56,
    left: 16,
    right: 16,
    zIndex: 100,
    elevation: 12,
    backgroundColor: "rgba(30,30,30,0.96)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  toastText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 18,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  headerTitle: {
    color: "#1DB954",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  headerStatusText: {
    fontSize: 11,
    fontWeight: "600",
  },

  // ── Status dot ────────────────────────────────────────────────────────────
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ── BT off banner ─────────────────────────────────────────────────────────
  btOffBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "rgba(255,76,76,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,76,76,0.15)",
  },
  btOffText: {
    color: "#aaa",
    fontSize: 13,
  },
  btOffAction: {
    color: "#FF4C4C",
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Scroll ────────────────────────────────────────────────────────────────
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },

  // ── Section wrapper ───────────────────────────────────────────────────────
  section: {
    gap: 12,
    marginBottom: 8,
  },

  // ── Scan button ───────────────────────────────────────────────────────────
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: 26,
    backgroundColor: "#1DB954",
  },
  scanButtonBusy: {
    backgroundColor: "#1a5e35",
  },
  scanButtonText: {
    color: "#000",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  scanHint: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    fontStyle: "italic",
  },

  // ── Device list ───────────────────────────────────────────────────────────
  deviceList: {
    gap: 8,
    marginTop: 4,
  },
  sectionLabel: {
    color: "#444",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  deviceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#161616",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  deviceId: {
    color: "#444",
    fontSize: 10,
    marginTop: 3,
  },
  connectBtn: {
    backgroundColor: "#1DB954",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    minWidth: 88,
    alignItems: "center",
  },
  connectBtnBusy: {
    backgroundColor: "#1a5e35",
  },
  connectBtnText: {
    color: "#000",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  // ── Warmup ring ───────────────────────────────────────────────────────────
  ringContainer: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 16,
    backgroundColor: "#161616",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  ringSvgWrap: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  ringTrack: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 6,
  },
  ringProgress: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 6,
    borderColor: "#1DB954",
    borderLeftColor: "transparent",
    borderBottomColor: "transparent",
  },
  ringCenter: {
    alignItems: "center",
  },
  ringNumber: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "800",
  },
  ringLabel: {
    color: "#555",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  warmupTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  warmupSub: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 18,
  },

  // ── Ready card ────────────────────────────────────────────────────────────
  readyCard: {
    alignItems: "center",
    backgroundColor: "#161616",
    borderRadius: 20,
    padding: 32,
    borderWidth: 1,
    borderColor: "rgba(29,185,84,0.15)",
    gap: 12,
  },
  readyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(29,185,84,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(29,185,84,0.3)",
  },
  readyIcon: {
    fontSize: 28,
    color: "#1DB954",
  },
  readyTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  readySub: {
    color: "#555",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  readyBtn: {
    marginTop: 8,
    backgroundColor: "#1DB954",
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 28,
  },
  readyBtnDisabled: {
    backgroundColor: "#555",
    opacity: 0.5,
  },
  readyBtnText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1,
  },

  // ── Scanning BAC card ─────────────────────────────────────────────────────
  scanningCard: {
    alignItems: "center",
    backgroundColor: "#161616",
    borderRadius: 20,
    padding: 32,
    borderWidth: 1,
    borderColor: "rgba(59,139,235,0.2)",
    gap: 16,
  },
  scanningTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  scanningSub: {
    color: "#888",
    fontSize: 13,
    textAlign: "center",
  },
  progressTrack: {
    width: "100%",
    height: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#3B8BEB",
    borderRadius: 3,
  },
  scanningNote: {
    color: "#444",
    fontSize: 11,
  },

  // ── Result card ───────────────────────────────────────────────────────────
  resultCard: {
    alignItems: "center",
    backgroundColor: "#161616",
    borderRadius: 20,
    padding: 32,
    borderWidth: 1,
    gap: 16,
  },
  resultBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  resultVerdict: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  resultBac: {
    fontSize: 56,
    fontWeight: "800",
    letterSpacing: -1,
  },
  resultBacMg: {
    color: "#666",
    fontSize: 13,
    marginTop: -8,
  },
  resultMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    marginTop: 4,
  },
  resultMetaItem: {
    alignItems: "center",
  },
  resultMetaLabel: {
    color: "#555",
    fontSize: 10,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  resultMetaValue: {
    color: "#aaa",
    fontSize: 13,
    fontWeight: "600",
  },
  resultMetaDivider: {
    width: 1,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  clearBtn: {
    marginTop: 4,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  clearBtnText: {
    color: "#666",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },

  // ── Disconnect button ─────────────────────────────────────────────────────
  disconnectBtn: {
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  disconnectBtnText: {
    color: "#555",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },

  // ── History ───────────────────────────────────────────────────────────────
  historySection: {
    marginTop: 16,
    gap: 4,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
    gap: 10,
  },
  historyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  historyBac: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  historyTime: {
    color: "#555",
    fontSize: 11,
  },
  historyVerdict: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    width: 40,
    textAlign: "right",
  },

  // ── Legal note ────────────────────────────────────────────────────────────
  legalNote: {
    color: "#282828",
    fontSize: 9,
    textAlign: "center",
    marginTop: 24,
  },
});