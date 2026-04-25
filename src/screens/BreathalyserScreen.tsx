import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Platform,
  Animated,
  ActivityIndicator,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { State } from "react-native-ble-plx";
import { breathalyser, type ScannedDevice } from "../features/breathalyser";
import { useBreathalyser } from "../context/BreathalyserContext";
import { usePermissions } from "../hooks/usePermissions";

// ─── Error helpers ────────────────────────────────────────────────────────────
function toFriendlyError(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("permission")) return "Bluetooth permission denied. Enable it in Settings.";
  if (lower.includes("powered") || lower.includes("bluetooth is off")) return "Bluetooth is off. Turn it on first.";
  if (lower.includes("cancelled")) return "Connection was cancelled. Please try again.";
  if (lower.includes("timed out") || lower.includes("timeout")) return "Connection timed out. Make sure BlowSafe is on and nearby.";
  if (lower.includes("already connected")) return "Device is already connected.";
  if (lower.includes("not connected")) return "Device is not connected.";
  if (lower.includes("no devices")) return "No devices found. Ensure BlowSafe is powered on and nearby.";
  return raw;
}

// ─── Pulsing LED ──────────────────────────────────────────────────────────────
function StatusLed({ status }: { status: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  const pulsing =
    status === "scanning" ||
    status === "connecting" ||
    status === "scanning_bac" ||
    status === "recalibrating";

  useEffect(() => {
    if (pulsing) {
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.25, duration: 550, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      );
      loop.current?.start();
    } else {
      loop.current?.stop();
      opacity.setValue(1);
    }
    return () => { loop.current?.stop(); };
  }, [pulsing, opacity]);

  const color =
    status === "ready" ? "#1DB954" :
    status === "connected" ? "#1DB954" :
    status === "scanning_bac" ? "#1e90ff" :
    status === "scanning" ? "#1e90ff" :
    status === "connecting" ? "#f5a623" :
    status === "warmup" ? "#f5a623" :
    status === "recalibrating" ? "#f5a623" :
    status === "error" ? "#FF4C4C" :
    "#333";

  return <Animated.View style={[s.led, { backgroundColor: color, opacity }]} />;
}

// ─── Device row ───────────────────────────────────────────────────────────────
function DeviceRow({
  device,
  connectedId,
  connectingId,
  onConnect,
  onDisconnect,
}: {
  device: ScannedDevice;
  connectedId: string | null;
  connectingId: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const thisConnected = connectedId === device.id;
  const thisConnecting = connectingId === device.id;

  return (
    <View style={[s.deviceRow, thisConnected && s.deviceRowConnected, thisConnecting && s.deviceRowConnecting]}>
      <View style={s.deviceRowLeft}>
        <View style={s.deviceNameLine}>
          <Text style={s.deviceName} numberOfLines={1}>{device.name}</Text>
          {thisConnected && (
            <View style={s.badge}>
              <Text style={s.badgeText}>CONNECTED</Text>
            </View>
          )}
          {thisConnecting && (
            <View style={s.badgeWarm}>
              <ActivityIndicator size="small" color="#f5a623" style={{ width: 10, height: 10 }} />
              <Text style={s.badgeWarmText}>CONNECTING…</Text>
            </View>
          )}
        </View>
        <Text style={s.deviceId} numberOfLines={1}>{device.id}</Text>
      </View>
      <View style={s.deviceRowRight}>
        {thisConnected ? (
          <TouchableOpacity style={s.btnDisconnect} onPress={onDisconnect} activeOpacity={0.75}>
            <Text style={s.btnDisconnectText}>DISCONNECT</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.btnConnect, (thisConnecting || !!connectedId) && s.btnMuted]}
            onPress={onConnect}
            disabled={thisConnecting || !!connectedId}
            activeOpacity={0.75}
          >
            <Text style={s.btnConnectText}>{thisConnecting ? "…" : "CONNECT"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── BAC result card ──────────────────────────────────────────────────────────
function BACCard({
  result,
  onClear,
}: {
  result: NonNullable<ReturnType<typeof useBreathalyser>["result"]>;
  onClear: () => void;
}) {
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeIn]);

  const fail = result.overLimit;

  return (
    <Animated.View style={[s.resultCard, fail ? s.resultFail : s.resultPass, { opacity: fadeIn }]}>
      <View style={s.resultHeader}>
        <Text style={s.resultLabel}>BAC READING</Text>
        <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Text style={s.clearText}>✕ CLEAR</Text>
        </TouchableOpacity>
      </View>
      <View style={s.bacCenter}>
        <Text style={[s.bacBig, fail ? s.red : s.green]}>{result.bacPercent}</Text>
        <Text style={s.bacMg}>{result.bacMg}</Text>
      </View>
      <View style={[s.verdictBox, fail ? s.verdictFail : s.verdictPass]}>
        <Text style={[s.verdictText, fail ? s.red : s.green]}>
          {fail ? "⚠  OVER LEGAL LIMIT — FAIL" : "✓  WITHIN LEGAL LIMIT — PASS"}
        </Text>
        <Text style={s.legalSmall}>
          Zimbabwe limit: 0.08% · {result.legalLimit * 1000} mg/100ml
        </Text>
      </View>
      <Text style={s.timestamp}>
        {new Date(result.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        {"  ·  "}
        {new Date(result.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
      </Text>
    </Animated.View>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────
function HistoryRow({ item }: { item: NonNullable<ReturnType<typeof useBreathalyser>["result"]> }) {
  const fail = item.overLimit;
  return (
    <View style={s.historyRow}>
      <View style={[s.historyDot, { backgroundColor: fail ? "#FF4C4C" : "#1DB954" }]} />
      <Text style={s.historyBac}>{item.bacPercent}</Text>
      <Text style={[s.historyStatus, { color: fail ? "#FF4C4C" : "#1DB954" }]}>{item.status}</Text>
      <Text style={s.historyTime}>
        {new Date(item.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function BreathalyserScreen() {
  const { requestBluetooth } = usePermissions();
  const {
    status,
    result,
    history,
    errorMsg,
    recalMsg,
    isConnected,
    connectedName,
    clearResult,
    pendingQueueCount,
  } = useBreathalyser();

  // ← LOCAL UI STATE ONLY (not in context)
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null); // ← Local only
  const [scanErr, setScanErr] = useState("");
  const [bleOff, setBleOff] = useState(false);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [pendingRetryAction, setPendingRetryAction] = useState<(() => void) | null>(null);
  const [queueBannerVisible, setQueueBannerVisible] = useState(true);
  const [accessibilityMessage, setAccessibilityMessage] = useState("");
  const [accessibilityPriority, setAccessibilityPriority] = useState<"assertive" | "polite">("polite");

  // Auto-clear accessibility messages
  useEffect(() => {
    if (accessibilityMessage) {
      const t = setTimeout(() => setAccessibilityMessage(""), 2500);
      return () => clearTimeout(t);
    }
  }, [accessibilityMessage]);

  // Sync local connectedId when context reports disconnect
  useEffect(() => {
    if (!isConnected) {
      setConnectedId(null);
    }
  }, [isConnected]);

  // ── BLE event subscription ──────────────────────────────────────────────────
  useEffect(() => {
    setBleOff(breathalyser.getBLEState() === State.PoweredOff);

    const unsub = breathalyser.on((event) => {
      switch (event.type) {
        case "ble_state":
          setBleOff(event.state === State.PoweredOff);
          break;

        case "scan_result":
          setDevices(event.devices);
          break;

        case "status":
          if (event.status === "connected") {
            setConnectingId(null);
            setScanning(false);
            setScanErr("");
          }
          if (event.status === "disconnected") {
            setConnectingId(null);
            setConnectedId(null); // ← Local state update
            setScanning(false);
          }
          break;

        case "error":
          setConnectingId(null);
          setScanning(false);
          setScanErr(toFriendlyError(event.message));
          break;

        case "accessibility":
          setAccessibilityMessage(event.message);
          setAccessibilityPriority(event.priority ?? "polite");
          break;

        case "progress":
          if (__DEV__ && event.step === "awaiting_sensor") {
            console.log("[Progress] Sensor active");
          }
          break;

        case "debug":
          // console.log("[BLE]", event.message);
          break;
      }
    });

    return () => unsub();
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleOpenBTSettings = useCallback(() => {
    if (Platform.OS === "android") {
      Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS").catch(() => Linking.openSettings());
    } else {
      Linking.openURL("App-Prefs:Bluetooth").catch(() => Linking.openSettings());
    }
  }, []);

  const handleScan = useCallback(async () => {
    setScanErr("");
    setDevices([]);
    const granted = await requestBluetooth();
    if (!granted) {
      setScanErr("Bluetooth permission denied. Enable it in Settings.");
      return;
    }
    setScanning(true);
    try {
      await breathalyser.scan();
    } catch (err: any) {
      setScanErr(toFriendlyError(err?.message ?? "Scan failed. Try again."));
    } finally {
      setScanning(false);
    }
  }, [requestBluetooth]);

  const handleConnect = useCallback(async (device: ScannedDevice) => {
    if (connectingId !== null || isConnected) return;
    setConnectingId(device.id);
    setScanErr("");
    try {
      await breathalyser.connect(device);
      setConnectedId(device.id); // ← Local state update
    } catch (err: any) {
      setScanErr(toFriendlyError(err?.message ?? "Connection failed. Try again."));
      setConnectingId(null);
    }
  }, [connectingId, isConnected]);

  const handleDisconnect = useCallback(async () => {
    breathalyser.stopScan();
    await breathalyser.disconnect();
    clearResult();
    setDevices([]);
    setScanErr("");
    setConnectingId(null);
    setConnectedId(null); // ← Local state update
  }, [clearResult]);

  const handleRetryConfirm = useCallback((confirmed: boolean) => {
    setShowRetryModal(false);
    if (confirmed && pendingRetryAction) {
      pendingRetryAction();
      setPendingRetryAction(null);
    }
  }, [pendingRetryAction]);

  // ── Derived display values ──────────────────────────────────────────────────
  const isWarmup = status === "warmup";
  const isBacScan = status === "scanning_bac";
  const isRecal = status === "recalibrating";
  const isCtxConnect = status === "connecting";
  const isCtxScan = status === "scanning";
  const isError = status === "error";
  const isReady = status === "ready";
  const isReconnecting = (isCtxConnect || isCtxScan) && connectingId === null && !scanning;
  const canScan = !bleOff && !isConnected && !scanning && connectingId === null;

  const statusLabel =
    isWarmup ? "Warming up — wait ~60s after power on" :
    isReady ? "Ready — tap Get Reading on Home screen" :
    isBacScan ? "BAC scan in progress…" :
    isRecal ? "Recalibrating sensor…" :
    isCtxConnect ? "Connecting to device…" :
    isCtxScan ? "Scanning for devices…" :
    isError ? "Device error" :
    isConnected ? "Connected" :
    "Not connected";

  const ledStatus =
    isReady ? "ready" :
    isBacScan ? "scanning_bac" :
    isRecal ? "recalibrating" :
    isWarmup ? "warmup" :
    isCtxConnect ? "connecting" :
    isCtxScan ? "scanning" :
    isError ? "error" :
    isConnected ? "connected" :
    "disconnected";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <View style={s.topBar}>
        <Text style={s.title}>Breathalyser</Text>
        <View style={[s.pill, isConnected ? s.pillOn : s.pillOff]}>
          <View style={[s.pillDot, isConnected ? s.dotGreen : s.dotGrey]} />
          <Text style={[s.pillText, isConnected ? s.pillTextOn : s.pillTextOff]} numberOfLines={1}>
            {isReconnecting ? "Reconnecting…" : isConnected ? connectedName : "No device"}
          </Text>
        </View>
      </View>

      {/* ── Bluetooth off banner ─────────────────────────────────────────── */}
      {bleOff && (
        <View style={s.btBanner}>
          <View style={s.btBannerLeft}>
            <View style={s.btBannerDot} />
            <Text style={s.btBannerText}>Bluetooth is off</Text>
          </View>
          <TouchableOpacity style={s.btBannerBtn} onPress={handleOpenBTSettings} activeOpacity={0.75}>
            <Text style={s.btBannerBtnText}>TURN ON</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* ── Queue banner ───────────────────────────────────────────────── */}
        {pendingQueueCount > 0 && queueBannerVisible && (
          <View style={s.queueBanner}>
            <Text style={s.queueBannerText}>
              ⏳ {pendingQueueCount} reading{pendingQueueCount > 1 ? "s" : ""} queued for retry
            </Text>
            <TouchableOpacity onPress={() => setQueueBannerVisible(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Text style={s.queueBannerDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Connection status card ─────────────────────────────────────── */}
        <View style={[s.card, isConnected && s.cardConnected]}>
          <View style={s.statusRow}>
            <StatusLed status={ledStatus} />
            <View style={s.statusTextBlock}>
              <Text style={s.statusLabel}>{statusLabel}</Text>
              {isConnected && <Text style={s.statusSub}>{connectedName}</Text>}
            </View>
            {isConnected && (
              <TouchableOpacity style={s.inlineDisconnect} onPress={handleDisconnect} activeOpacity={0.75}>
                <Text style={s.inlineDisconnectText}>Disconnect</Text>
              </TouchableOpacity>
            )}
          </View>
          {isRecal && !!recalMsg && (
            <View style={s.recalStrip}>
              <Text style={s.recalStripText}>⚠  {recalMsg}</Text>
            </View>
          )}
          {isError && !!errorMsg && (
            <View style={s.errorStrip}>
              <Text style={s.errorStripText}>{errorMsg}</Text>
            </View>
          )}
        </View>

        {/* ── Scan/connect error ─────────────────────────────────────────── */}
        {!!scanErr && (
          <View style={s.errorBox}>
            <Text style={s.errorBoxText} numberOfLines={3}>{scanErr}</Text>
            <TouchableOpacity onPress={() => setScanErr("")} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Text style={s.errorBoxDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Scan button ───────────────────────────────────────────────── */}
        {!isConnected && (
          <TouchableOpacity style={[s.scanBtn, !canScan && s.scanBtnOff]} onPress={handleScan} disabled={!canScan} activeOpacity={0.8}>
            {scanning ? (
              <View style={s.scanBtnRow}>
                <ActivityIndicator color="#000" size="small" />
                <Text style={s.scanBtnText}>Scanning for devices…</Text>
              </View>
            ) : (
              <Text style={s.scanBtnText}>{bleOff ? "Enable Bluetooth to Scan" : "Scan for BlowSafe Devices"}</Text>
            )}
          </TouchableOpacity>
        )}

        {/* ── Device list ───────────────────────────────────────────────── */}
        {devices.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>{scanning ? "SCANNING…" : `${devices.length} DEVICE${devices.length !== 1 ? "S" : ""} FOUND`}</Text>
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                connectedId={connectedId} // ← Local state
                connectingId={connectingId} // ← Local state
                onConnect={() => handleConnect(device)}
                onDisconnect={handleDisconnect}
              />
            ))}
          </View>
        )}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {!scanning && !isConnected && devices.length === 0 && !scanErr && (
          <View style={s.emptyBox}>
            <Text style={s.emptyIcon}>◉</Text>
            <Text style={s.emptyTitle}>No devices found</Text>
            <Text style={s.emptyBody}>Power on your BlowSafe breathalyser and make sure it is within range, then tap Scan.</Text>
          </View>
        )}

        {/* ── Warmup / BAC scan / recal progress card ───────────────────── */}
        {isConnected && !result && (isWarmup || isBacScan || isRecal) && (
          <View style={s.progressCard}>
            <ActivityIndicator size="large" color={isBacScan ? "#1e90ff" : "#f5a623"} />
            <Text style={s.progressTitle}>{isBacScan ? "Reading sensor…" : isWarmup ? "Warming up…" : "Recalibrating…"}</Text>
            <Text style={s.progressBody}>
              {isBacScan ? "Have the driver blow steadily into the device." : isWarmup ? "Device needs approximately 60 seconds to stabilise after powering on." : "Sensor is elevated — wait for recalibration to complete before the next test."}
            </Text>
          </View>
        )}

        {/* ── BAC result card ───────────────────────────────────────────── */}
        {!!result && <BACCard result={result} onClear={clearResult} />}

        {/* ── Session history ───────────────────────────────────────────── */}
        {history.length > 0 && (
          <View style={[s.card, { marginTop: 4 }]}>
            <Text style={s.sectionLabel}>SESSION HISTORY</Text>
            {history.map((item, i) => (
              <HistoryRow key={`${item.timestamp}-${i}`} item={item} />
            ))}
          </View>
        )}

        {/* ── Legal footer ─────────────────────────────────────────────── */}
        <Text style={s.legalFooter}>Zimbabwe Road Traffic Act · Legal limit 0.08% BAC · 80 mg/100ml</Text>
      </ScrollView>

      {/* ── Accessibility live region (visually hidden) ────────────────── */}
      <View
        accessibilityLiveRegion={accessibilityPriority}
        accessibilityLabel={accessibilityMessage}
        style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
        pointerEvents="none"
        importantForAccessibility="yes"
      >
        <Text>{accessibilityMessage}</Text>
      </View>

      {/* ── Retry confirmation modal ───────────────────────────────────── */}
      <Modal visible={showRetryModal} transparent animationType="fade" onRequestClose={() => handleRetryConfirm(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Reading Interrupted</Text>
            <Text style={s.modalMessage}>The breathalyser connection was lost. Would you like to retry the reading?</Text>
            <View style={s.modalButtons}>
              <TouchableOpacity style={[s.modalBtn, s.modalBtnSecondary]} onPress={() => handleRetryConfirm(false)} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                <Text style={s.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.modalBtnPrimary]} onPress={() => handleRetryConfirm(true)} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                <Text style={s.modalBtnTextPrimary}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#121212" },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  title: { color: "#1DB954", fontSize: 16, fontWeight: "800" },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, maxWidth: 180 },
  pillOn: { borderColor: "rgba(29,185,84,0.3)", backgroundColor: "rgba(29,185,84,0.08)" },
  pillOff: { borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.03)" },
  pillDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  dotGreen: { backgroundColor: "#1DB954" },
  dotGrey: { backgroundColor: "#444" },
  pillText: { fontSize: 10, fontWeight: "600", flexShrink: 1 },
  pillTextOn: { color: "#1DB954" },
  pillTextOff: { color: "#555" },
  btBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255,76,76,0.08)", borderBottomWidth: 1, borderBottomColor: "rgba(255,76,76,0.2)", paddingHorizontal: 14, paddingVertical: 10 },
  btBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  btBannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FF4C4C" },
  btBannerText: { color: "#FF4C4C", fontSize: 12, fontWeight: "600" },
  btBannerBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 4, borderWidth: 1, borderColor: "#FF4C4C" },
  btBannerBtnText: { color: "#FF4C4C", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  content: { padding: 12, paddingBottom: 120 },
  card: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  cardConnected: { borderColor: "rgba(29,185,84,0.2)" },
  led: { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusTextBlock: { flex: 1 },
  statusLabel: { color: "#fff", fontSize: 13, fontWeight: "600" },
  statusSub: { color: "#1DB954", fontSize: 10, marginTop: 2 },
  inlineDisconnect: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: "#2a2a2a" },
  inlineDisconnectText: { color: "#555", fontSize: 10, fontWeight: "600" },
  recalStrip: { marginTop: 10, backgroundColor: "rgba(245,166,35,0.08)", borderLeftWidth: 3, borderLeftColor: "#f5a623", borderRadius: 6, padding: 8 },
  recalStripText: { color: "#f5a623", fontSize: 11, fontWeight: "600" },
  errorStrip: { marginTop: 10, backgroundColor: "rgba(255,76,76,0.08)", borderLeftWidth: 3, borderLeftColor: "#FF4C4C", borderRadius: 6, padding: 8 },
  errorStripText: { color: "#FF4C4C", fontSize: 11 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", backgroundColor: "rgba(255,76,76,0.08)", borderLeftWidth: 3, borderLeftColor: "#FF4C4C", borderRadius: 8, padding: 10, marginBottom: 10, gap: 8 },
  errorBoxText: { color: "#FF4C4C", fontSize: 12, flex: 1, lineHeight: 18 },
  errorBoxDismiss: { color: "#FF4C4C", fontSize: 14, fontWeight: "700" },
  scanBtn: { backgroundColor: "#1DB954", paddingVertical: 14, borderRadius: 25, alignItems: "center", marginBottom: 12 },
  scanBtnOff: { opacity: 0.4 },
  scanBtnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scanBtnText: { color: "#000", fontWeight: "700", fontSize: 14 },
  section: { marginBottom: 10 },
  sectionLabel: { color: "#444", fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  deviceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#111", borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: "#1e1e1e" },
  deviceRowConnected: { borderColor: "rgba(29,185,84,0.35)", backgroundColor: "rgba(29,185,84,0.04)" },
  deviceRowConnecting: { borderColor: "rgba(245,166,35,0.35)", backgroundColor: "rgba(245,166,35,0.04)" },
  deviceRowLeft: { flex: 1, marginRight: 10 },
  deviceNameLine: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  deviceName: { color: "#fff", fontSize: 13, fontWeight: "600" },
  deviceId: { color: "#2a2a2a", fontSize: 9, marginTop: 3 },
  badge: { backgroundColor: "rgba(29,185,84,0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: "rgba(29,185,84,0.3)" },
  badgeText: { color: "#1DB954", fontSize: 8, fontWeight: "800" },
  badgeWarm: { flexDirection: "row", alignItems: "center", gap: 4 },
  badgeWarmText: { color: "#f5a623", fontSize: 8, fontWeight: "700" },
  btnConnect: { backgroundColor: "#1DB954", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  btnConnectText: { color: "#000", fontSize: 11, fontWeight: "800" },
  btnMuted: { opacity: 0.35 },
  btnDisconnect: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,76,76,0.4)" },
  btnDisconnectText: { color: "#FF4C4C", fontSize: 10, fontWeight: "700" },
  emptyBox: { alignItems: "center", padding: 28, backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 12, borderWidth: 1, borderColor: "#1e1e1e", borderStyle: "dashed", marginBottom: 12, gap: 8 },
  emptyIcon: { fontSize: 30, color: "#2a2a2a" },
  emptyTitle: { color: "#444", fontSize: 13, fontWeight: "700" },
  emptyBody: { color: "#333", fontSize: 11, textAlign: "center", lineHeight: 17 },
  progressCard: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 24, alignItems: "center", gap: 12, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  progressTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },
  progressBody: { color: "#555", fontSize: 12, textAlign: "center", lineHeight: 18 },
  resultCard: { backgroundColor: "#1a1a1a", borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  resultFail: { borderColor: "rgba(255,76,76,0.35)", backgroundColor: "rgba(255,76,76,0.04)" },
  resultPass: { borderColor: "rgba(29,185,84,0.35)", backgroundColor: "rgba(29,185,84,0.03)" },
  resultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  resultLabel: { color: "#555", fontSize: 9, fontWeight: "800", letterSpacing: 2 },
  clearText: { color: "#555", fontSize: 10, fontWeight: "700" },
  bacCenter: { alignItems: "center", paddingVertical: 12, gap: 4 },
  bacBig: { fontSize: 48, fontWeight: "800", letterSpacing: 1 },
  bacMg: { color: "#555", fontSize: 12 },
  green: { color: "#1DB954" },
  red: { color: "#FF4C4C" },
  verdictBox: { borderRadius: 8, padding: 10, alignItems: "center", marginBottom: 8, gap: 4 },
  verdictFail: { backgroundColor: "rgba(255,76,76,0.1)" },
  verdictPass: { backgroundColor: "rgba(29,185,84,0.08)" },
  verdictText: { fontWeight: "700", fontSize: 12, textAlign: "center" },
  legalSmall: { color: "#444", fontSize: 10, textAlign: "center" },
  timestamp: { color: "#333", fontSize: 10, textAlign: "center", marginTop: 4 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#111" },
  historyDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  historyBac: { color: "#fff", fontSize: 12, fontWeight: "600", flex: 1 },
  historyStatus: { fontSize: 11, fontWeight: "700", width: 36 },
  historyTime: { color: "#333", fontSize: 10 },
  legalFooter: { color: "#1e1e1e", fontSize: 9, textAlign: "center", marginTop: 16 },

  // ← NEW: Queue banner styles
  queueBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(30,144,255,0.12)",
    borderLeftWidth: 3,
    borderLeftColor: "#1e90ff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    marginHorizontal: 12,
  },
  queueBannerText: { color: "#1e90ff", fontSize: 11, fontWeight: "600", flex: 1 },
  queueBannerDismiss: { color: "#1e90ff", fontSize: 14, fontWeight: "700", paddingHorizontal: 8 },

  // ← NEW: Modal styles
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalContent: { backgroundColor: "#1a1a1a", borderRadius: 16, padding: 20, width: "100%", maxWidth: 340, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", elevation: 8 },
  modalTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 10 },
  modalMessage: { color: "#aaa", fontSize: 13, lineHeight: 19, marginBottom: 24 },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, minWidth: 84, alignItems: "center" },
  modalBtnPrimary: { backgroundColor: "#1DB954" },
  modalBtnSecondary: { backgroundColor: "rgba(255,255,255,0.1)" },
  modalBtnTextPrimary: { color: "#000", fontWeight: "700", fontSize: 14 },
  modalBtnTextSecondary: { color: "#fff", fontWeight: "600", fontSize: 14 },
});