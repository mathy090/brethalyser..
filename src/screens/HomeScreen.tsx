import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, StatusBar,
  Image, TouchableOpacity, ScrollView, Animated, ActivityIndicator,
  Modal,
} from "react-native";
import { SafeAreaView }     from "react-native-safe-area-context";
import { useOfficer }       from "../context/OfficerContext";
import { useNetworkStatus } from "../helpers/network";
import { useLiveClock }     from "../hooks/useLiveClock";
import { useBreathalyser }  from "../context/BreathalyserContext";
import {
  getReadingState,
  getReadingLabel,
  canPressReading,
  triggerReading,
  type ReadingState,
} from "../helpers/useGetReading";
import { type DriverData }  from "../helpers/constants";
import DriverCard           from "../features/home/DriverCard";

// ── Pulse ring ──────────────────────────────────────────────────────────────
function PulseRing({ active, color }: { active: boolean; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 400, useNativeDriver: true }),
        ])
      );
      loop.current.start();
    } else {
      loop.current?.stop();
      anim.setValue(0);
    }
    return () => { loop.current?.stop(); };
  }, [active, anim]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          borderRadius: 14,
          borderWidth:  2.5,
          borderColor:  color,
          opacity:      active ? anim : 0,
        },
      ]}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { officer }          = useOfficer();
  const { isConnected }      = useNetworkStatus();
  const { date, time }       = useLiveClock();
  const {
    status:        bleStatus,
    result:        bacResult,
    errorMsg:      bleError,
    recalMsg,
    battery,
    isConnected:   deviceConnected,
    isAwaitingBac,
    connectedName,
    clearResult,
    requestScan,
    getReading,              // ← Enhanced helper
    announceAccessibility,   // ← Accessibility emitter
    pendingQueueCount,       // ← Offline queue count
  } = useBreathalyser();

  const [driverValid,  setDriverValid]  = useState(false);
  const [licencePhoto, setLicencePhoto] = useState<string | null>(null);
  
  // ← NEW: State for enhanced flow (no UI layout changes)
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [pendingRetryAction, setPendingRetryAction] = useState<(() => void) | null>(null);
  const [queueBannerVisible, setQueueBannerVisible] = useState(true);
  const [accessibilityMsg, setAccessibilityMsg] = useState("");
  const [accessibilityPriority, setAccessibilityPriority] = useState<"assertive" | "polite">("polite");

  // ← Auto-clear accessibility messages to avoid screen reader spam
  useEffect(() => {
    if (accessibilityMsg) {
      const t = setTimeout(() => setAccessibilityMsg(""), 2500);
      return () => clearTimeout(t);
    }
  }, [accessibilityMsg]);

  const handleDriverChange = useCallback(
    (_data: DriverData, isValid: boolean, photoUri: string | null) => {
      setDriverValid(isValid);
      if (photoUri) setLicencePhoto(photoUri);
      else if (!isValid) setLicencePhoto(null);
    },
    []
  );

  const handleUpload = useCallback(() => {
    // upload logic
  }, []);

  // ── Reading state — all derived from single sources of truth ─────────────
  const overLimit:    boolean | null = bacResult?.overLimit ?? null;
  const readingState: ReadingState   = getReadingState(
    bleStatus, deviceConnected, overLimit, isAwaitingBac
  );
  const btnLabel: string  = getReadingLabel(readingState, isAwaitingBac);
  const canPress: boolean = canPressReading(readingState, isAwaitingBac);

  const isReading  = readingState === "awaiting_bac";
  const isRecal    = readingState === "recalibrating";
  const isWarmup   = readingState === "warmup";
  const isPulsing  = isReading || isRecal;
  const pulseColor = isRecal ? "#f5a623" : "#1e90ff";

  const readingBtnBg =
    isReading ? "#1e90ff" :
    isRecal   ? "#f5a623" :
    canPress  ? "#1DB954" :
    "#1a1a1a";

  const readingBtnTextColor =
    isReading ? "#fff" :
    isRecal   ? "#000" :
    canPress  ? "#000" :
    "#444";

  const ledColor =
    isWarmup                       ? s.ledBlue   :
    isReading                      ? s.ledBlue   :
    isRecal                        ? s.ledOrange :
    readingState === "done_fail"   ? s.ledRed    :
    readingState === "done_pass"   ? s.ledGreen  :
    readingState === "ready"       ? s.ledGreen  :
    readingState === "error"       ? s.ledRed    :
    s.ledGrey;

  const resultEmptyText =
    isAwaitingBac                    ? "Reading sensor…"       :
    isWarmup                         ? "Device warming up…"    :
    isRecal                          ? "Recalibrating sensor…" :
    readingState === "error"         ? "Device error"          :
    readingState === "ready"         ? "No reading yet"        :
    deviceConnected                  ? "No reading yet"        :
    "Connect breathalyser to read";

  // ── Get reading — enhanced with confirmation, accessibility, queue ───────
  const handleGetReading = useCallback(async () => {
    if (isAwaitingBac) return;
    if (bacResult) clearResult();
    try {
      const outcome = await getReading({
        timeoutMs: 45_000,
        onAccessibilityAnnouncement: (msg: string, priority?: "assertive" | "polite") => {
          setAccessibilityMsg(msg);
          setAccessibilityPriority(priority ?? "polite");
          announceAccessibility?.(msg, priority);
        },
      });

      if (!outcome.success && outcome.requiresConfirmation) {
        setPendingRetryAction(() => async () => {
          await requestScan();
        });
        setShowRetryModal(true);
      } else if (!outcome.success) {
        console.log("[HomeScreen] Reading failed:", outcome.message);
      }
    } catch (err: any) {
      console.log("[HomeScreen] GetReading error:", err.message);
    }
  }, [isAwaitingBac, bacResult, bleStatus, clearResult, getReading, requestScan, announceAccessibility]);

  // ← Retry confirmation handler
  const handleRetryConfirm = useCallback((confirmed: boolean) => {
    setShowRetryModal(false);
    if (confirmed && pendingRetryAction) {
      pendingRetryAction();
      setPendingRetryAction(null);
    }
  }, [pendingRetryAction]);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />

      {/* ── Queue banner (minimal addition, no layout shift) ─────────────── */}
      {pendingQueueCount > 0 && queueBannerVisible && (
        <View style={s.queueBanner}>
          <Text style={s.queueBannerText}>
            ⏳ {pendingQueueCount} reading{pendingQueueCount > 1 ? "s" : ""} queued for retry
          </Text>
          <TouchableOpacity 
            onPress={() => setQueueBannerVisible(false)} 
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Text style={s.queueBannerDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <View style={s.topBar}>
        <View style={s.logoWrap}>
          <Image
            source={require("../../assets/background.png")}
            style={s.logo}
          />
        </View>

        <View style={s.island}>
          <Text style={s.islandName}>BlowSafe</Text>
          <View style={s.islandDivider} />
          <View style={s.islandClock}>
            <Text style={s.islandTime}>{time}</Text>
            <Text style={s.islandDate}>{date}</Text>
          </View>
        </View>

        <View style={s.statusPill}>
          <View style={[
            s.statusDot,
            { backgroundColor: isConnected ? "#1DB954" : "#FF4C4C" },
          ]} />
          <Text style={[
            s.statusText,
            { color: isConnected ? "#1DB954" : "#FF4C4C" },
          ]}>
            {isConnected ? "Online" : "Offline"}
          </Text>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Device bar ────────────────────────────────────────────────── */}
        <View style={[s.deviceBar, deviceConnected ? s.deviceBarOn : s.deviceBarOff]}>
          <View style={[s.deviceDot, deviceConnected ? s.dotGreen : s.dotGrey]} />
          <Text
            style={[s.deviceText, deviceConnected ? s.deviceTextOn : s.deviceTextOff]}
            numberOfLines={1}
          >
            {deviceConnected
              ? `${connectedName}${battery > 0 ? `  ·  ${battery}%` : "  ·  Connected"}`
              : "No breathalyser — go to Breathalyser tab"}
          </Text>
          {isWarmup && (
            <View style={s.warmupChip}>
              <Text style={s.warmupChipText}>Warming up</Text>
            </View>
          )}
          {isAwaitingBac && (
            <View style={s.readingChip}>
              <ActivityIndicator size="small" color="#1e90ff" style={{ width: 10, height: 10 }} />
              <Text style={s.readingChipText}>Reading…</Text>
            </View>
          )}
        </View>

        {/* ── Driver card ───────────────────────────────────────────────── */}
        <DriverCard onDataChange={handleDriverChange} />

        {/* ── Reading result card ───────────────────────────────────────── */}
        <View style={[
          s.resultCard,
          bacResult?.overLimit === true  ? s.resultCardFail : null,
          bacResult?.overLimit === false ? s.resultCardPass : null,
          isAwaitingBac                  ? s.resultCardReading : null,
        ]}>
          {bacResult && !isAwaitingBac ? (
            <View style={s.resultContent}>
              <View style={s.resultLeft}>
                <Text style={[
                  s.bacBig,
                  bacResult.overLimit ? s.textFail : s.textPass,
                ]}>
                  {bacResult.bacPercent}
                </Text>
                <Text style={s.bacMg}>{bacResult.bacMg}</Text>
              </View>
              <TouchableOpacity style={s.clearBtn} onPress={clearResult}>
                <Text style={s.clearBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : isAwaitingBac ? (
            // ── Loading state while awaiting BAC ─────────────────────────
            <View style={s.resultAwaiting}>
              <ActivityIndicator size="large" color="#1e90ff" />
              <View style={s.resultAwaitingText}>
                <Text style={s.resultAwaitingTitle}>Reading sensor</Text>
                <Text style={s.resultAwaitingBody}>
                  Have the driver blow steadily into the device
                </Text>
              </View>
            </View>
          ) : (
            <View style={s.resultEmpty}>
              <View style={[s.resultLed, ledColor]} />
              <Text style={s.resultEmptyText}>{resultEmptyText}</Text>
            </View>
          )}

          {!isAwaitingBac && bleError ? (
            <View style={s.errorRow}>
              <Text style={s.errorText}>{bleError}</Text>
            </View>
          ) : null}

          {!isAwaitingBac && isRecal ? (
            <View style={s.recalRow}>
              <Text style={s.recalText}>
                ⚠  {recalMsg || "Sensor elevated — recalibrating. Wait before next reading."}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Buttons ───────────────────────────────────────────────────── */}
        <View style={s.btnRow}>
          <View style={s.readingWrap}>
            <PulseRing active={isPulsing} color={pulseColor} />
            <TouchableOpacity
              style={[
                s.readingBtn,
                { backgroundColor: readingBtnBg },
                !canPress && !isReading && !isRecal ? s.readingBtnOff : null,
              ]}
              onPress={handleGetReading}
              disabled={!canPress && !isReading}
              activeOpacity={0.85}
            >
              {isAwaitingBac ? (
                <View style={s.readingBtnInner}>
                  <ActivityIndicator
                    size="small"
                    color="#fff"
                    style={{ width: 16, height: 16 }}
                  />
                  <Text style={[s.readingBtnText, { color: "#fff" }]}>
                    {btnLabel}
                  </Text>
                </View>
              ) : (
                <Text style={[s.readingBtnText, { color: readingBtnTextColor }]}>
                  {btnLabel}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[s.uploadBtn, !driverValid ? s.uploadBtnOff : null]}
            onPress={handleUpload}
            disabled={!driverValid}
            activeOpacity={0.85}
          >
            <Text style={[s.uploadBtnText, !driverValid ? s.uploadBtnTextOff : null]}>
              Upload
            </Text>
          </TouchableOpacity>
        </View>

        {!driverValid ? (
          <Text style={s.uploadHint}>Scan driver licence to enable upload</Text>
        ) : null}

        <Text style={s.legalNote}>
          Zimbabwe limit: 0.08% BAC · 80 mg/100ml · Road Traffic Act
        </Text>

      </ScrollView>

      {/* ── Accessibility live region (visually hidden, no layout impact) ─ */}
      <View
        accessibilityLiveRegion={accessibilityPriority}
        accessibilityLabel={accessibilityMsg}
        style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
        pointerEvents="none"
        importantForAccessibility="yes"
      >
        <Text>{accessibilityMsg}</Text>
      </View>

      {/* ── Retry confirmation modal (overlay, no layout shift) ─────────── */}
      <Modal
        visible={showRetryModal}
        transparent
        animationType="fade"
        onRequestClose={() => handleRetryConfirm(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Reading Interrupted</Text>
            <Text style={s.modalMessage}>
              The breathalyser connection was lost. Would you like to retry the reading?
            </Text>
            <View style={s.modalButtons}>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnSecondary]}
                onPress={() => handleRetryConfirm(false)}
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              >
                <Text style={s.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnPrimary]}
                onPress={() => handleRetryConfirm(true)}
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              >
                <Text style={s.modalBtnTextPrimary}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: "#121212" },
  topBar:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  logoWrap:        { width: 36, height: 36, borderRadius: 18, overflow: "hidden", borderWidth: 1.5, borderColor: "#1DB954" },
  logo:            { width: "100%", height: "100%", resizeMode: "cover" },
  island:          { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a1a1a", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 30, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", elevation: 6 },
  islandName:      { color: "#1DB954", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  islandDivider:   { width: 1, height: 14, backgroundColor: "rgba(255,255,255,0.1)" },
  islandClock:     { alignItems: "flex-start" },
  islandTime:      { color: "#fff", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: 0.5 },
  islandDate:      { color: "#555", fontSize: 9, fontWeight: "500" },
  statusPill:      { flexDirection: "row", alignItems: "center", gap: 4, width: 64, justifyContent: "flex-end" },
  statusDot:       { width: 7, height: 7, borderRadius: 3.5 },
  statusText:      { fontSize: 10, fontWeight: "700" },
  scroll:          { flex: 1 },
  content:         { padding: 12, paddingBottom: 40 },

  // Queue banner (minimal, non-intrusive)
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
  queueBannerText: {
    color: "#1e90ff",
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },
  queueBannerDismiss: {
    color: "#1e90ff",
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 8,
  },

  // Device bar
  deviceBar:       { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12, borderWidth: 1 },
  deviceBarOn:     { backgroundColor: "rgba(29,185,84,0.05)", borderColor: "rgba(29,185,84,0.2)" },
  deviceBarOff:    { backgroundColor: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" },
  deviceDot:       { width: 7, height: 7, borderRadius: 3.5, flexShrink: 0 },
  dotGreen:        { backgroundColor: "#1DB954" },
  dotGrey:         { backgroundColor: "#444" },
  deviceText:      { fontSize: 11, fontWeight: "600", flex: 1 },
  deviceTextOn:    { color: "#1DB954" },
  deviceTextOff:   { color: "#444" },

  // Chips
  warmupChip:      { backgroundColor: "rgba(30,144,255,0.12)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: "rgba(30,144,255,0.3)" },
  warmupChipText:  { color: "#1e90ff", fontSize: 9, fontWeight: "700" },
  readingChip:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(30,144,255,0.12)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: "rgba(30,144,255,0.3)" },
  readingChipText: { color: "#1e90ff", fontSize: 9, fontWeight: "700" },

  // Result card
  resultCard:        { backgroundColor: "#1a1a1a", borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", minHeight: 80, justifyContent: "center" },
  resultCardFail:    { borderColor: "rgba(255,76,76,0.35)", backgroundColor: "rgba(255,76,76,0.04)" },
  resultCardPass:    { borderColor: "rgba(29,185,84,0.35)", backgroundColor: "rgba(29,185,84,0.03)" },
  resultCardReading: { borderColor: "rgba(30,144,255,0.35)", backgroundColor: "rgba(30,144,255,0.04)" },

  resultContent:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resultLeft:       { gap: 2 },
  bacBig:           { fontSize: 38, fontWeight: "800", letterSpacing: 1 },
  bacMg:            { color: "#555", fontSize: 12 },
  textFail:         { color: "#FF4C4C" },
  textPass:         { color: "#1DB954" },
  clearBtn:         { padding: 8, borderRadius: 14, backgroundColor: "#111" },
  clearBtnText:     { color: "#555", fontSize: 14 },

  // Awaiting BAC loading state
  resultAwaiting:      { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 8 },
  resultAwaitingText:  { flex: 1, gap: 3 },
  resultAwaitingTitle: { color: "#1e90ff", fontSize: 14, fontWeight: "700" },
  resultAwaitingBody:  { color: "#555", fontSize: 11 },

  resultEmpty:      { flexDirection: "row", alignItems: "center", gap: 10 },
  resultLed:        { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  ledGrey:          { backgroundColor: "#333" },
  ledGreen:         { backgroundColor: "#1DB954" },
  ledBlue:          { backgroundColor: "#1e90ff" },
  ledOrange:        { backgroundColor: "#f5a623" },
  ledRed:           { backgroundColor: "#FF4C4C" },
  resultEmptyText:  { color: "#555", fontSize: 13 },

  errorRow:         { marginTop: 8 },
  errorText:        { color: "#FF4C4C", fontSize: 11 },
  recalRow:         { marginTop: 8, backgroundColor: "rgba(245,166,35,0.08)", borderLeftWidth: 3, borderLeftColor: "#f5a623", borderRadius: 6, padding: 8 },
  recalText:        { color: "#f5a623", fontSize: 11, fontWeight: "600" },

  // Buttons
  btnRow:           { flexDirection: "row", gap: 12, marginBottom: 8 },
  readingWrap:      { flex: 1, position: "relative" },
  readingBtn:       { paddingVertical: 16, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  readingBtnOff:    { backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#2a2a2a" },
  readingBtnInner:  { flexDirection: "row", alignItems: "center", gap: 8 },
  readingBtnText:   { fontSize: 15, fontWeight: "700" },
  uploadBtn:        { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#1DB954" },
  uploadBtnOff:     { borderColor: "#2a2a2a" },
  uploadBtnText:    { fontSize: 15, fontWeight: "700", color: "#1DB954" },
  uploadBtnTextOff: { color: "#333" },
  uploadHint:       { color: "#444", fontSize: 10, textAlign: "center", marginTop: 4 },
  legalNote:        { color: "#2a2a2a", fontSize: 9, textAlign: "center", marginTop: 12 },

  // Modal styles (overlay, no layout impact)
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    elevation: 8,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  modalMessage: {
    color: "#aaa",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    minWidth: 84,
    alignItems: "center",
  },
  modalBtnPrimary: {
    backgroundColor: "#1DB954",
  },
  modalBtnSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  modalBtnTextPrimary: {
    color: "#000",
    fontWeight: "700",
    fontSize: 14,
  },
  modalBtnTextSecondary: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
});