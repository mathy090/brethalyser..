import React, { useCallback, useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { breathalyser, type ScannedDevice } from "../features/breathalyser";
import { useBreathalyser } from "../context/BreathalyserContext";
import { usePermissions } from "../hooks/usePermissions";

function BatteryIcon({ level }: { level: number }) {
  const color = level > 50 ? "#1DB954" : level > 20 ? "#f5a623" : "#FF4C4C";
  const bars  = Math.round((level / 100) * 4);
  return (
    <View style={b.wrap}>
      <View style={b.body}>
        {[0,1,2,3].map(i => (
          <View key={i} style={[b.bar, { backgroundColor: i < bars ? color : "#2a2a2a" }]} />
        ))}
      </View>
      <View style={[b.tip, { borderColor: color }]} />
      <Text style={[b.pct, { color }]}>{level}%</Text>
    </View>
  );
}

export default function BreathalyserScreen() {
  const { requestBluetooth } = usePermissions();
  const {
    status, result, history,
    errorMsg, recalMsg, battery,
    isConnected, connectedName, clearResult,
  } = useBreathalyser();

  const [devices,    setDevices]    = useState<ScannedDevice[]>([]);
  const [scanning,   setScanning]   = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [scanErr,    setScanErr]    = useState("");

  const isBacScan      = status === "scanning_bac";
  const isRecal        = status === "recalibrating";
  const isWarmup       = status === "warmup";
  const canScan        = status === "ready";
  const isReconnecting = (status === "scanning" || status === "connecting") && connecting === null;

  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      if (event.type === "scan_result") setDevices(event.devices);
      if (event.type === "status") {
        if (event.status === "connected")    { setConnecting(null); setScanning(false); }
        if (event.status === "disconnected") { setConnecting(null); setScanning(false); }
      }
      if (event.type === "error") {
        setConnecting(null);
        setScanning(false);
        setScanErr(event.message);
      }
    });
    return () => unsub();
  }, []);

  // ── Scan for BlowSafe ──────────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    setScanErr("");
    setDevices([]);
    const granted = await requestBluetooth();
    if (!granted) { setScanErr("Bluetooth permission denied. Enable it in Settings."); return; }
    setScanning(true);
    try {
      await breathalyser.scan();
    } catch (err: any) {
      setScanErr(err?.message ?? "Scan failed");
    }
    setScanning(false);
  }, [requestBluetooth]);

  // ── Connect ────────────────────────────────────────────────────────────────
  const handleConnect = useCallback(async (device: ScannedDevice) => {
    setConnecting(device.id);
    setScanErr("");
    try {
      await breathalyser.connect(device);
    } catch (err: any) {
      setScanErr(err?.message ?? "Connection failed. Try again.");
      setConnecting(null);
    }
  }, []);

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(async () => {
    breathalyser.stopScan();
    await breathalyser.disconnect();
    clearResult();
    setDevices([]);
    setScanErr("");
    setConnecting(null);
  }, [clearResult]);

  const statusLabel =
    isWarmup  ? "Warming up — wait 60s after power on" :
    canScan   ? "Ready — tap Scan on Home screen"       :
    isBacScan ? "Scanning in progress…"                 :
    isRecal   ? "Recalibrating…"                        :
    status === "connecting" ? "Connecting…"             :
    status === "scanning"   ? "Scanning…"               :
    status === "error"      ? "Error"                   :
    "Connected";

  return (
    <SafeAreaView style={s.root} edges={["top"]}>

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <View style={s.topBar}>
        <Text style={s.title}>Breathalyser</Text>
        <View style={s.topRight}>
          {isConnected && battery > 0 && <BatteryIcon level={battery} />}
          <View style={[s.pill, isConnected ? s.pillOn : s.pillOff]}>
            <View style={[s.pillDot, isConnected ? s.dotGreen : s.dotGrey]} />
            <Text style={[s.pillText, isConnected ? s.pillTextOn : s.pillTextOff]}>
              {isReconnecting ? "Reconnecting…" : isConnected ? connectedName : "No device"}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── Not connected ──────────────────────────────────────────────── */}
        {!isConnected && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Device Connection</Text>

            {isReconnecting && (
              <View style={s.reconnectBox}>
                <ActivityIndicator color="#1DB954" size="small" />
                <Text style={s.reconnectText}>Reconnecting to BlowSafe…</Text>
              </View>
            )}

            <Text style={s.cardSub}>
              Power on the BlowSafe device and keep it nearby.
              Tap <Text style={s.highlight}>Scan for Devices</Text> — BlowSafe
              will appear in the list. Tap it to connect directly from the app.
              No Settings pairing needed.
            </Text>

            {(scanErr || errorMsg) ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{scanErr || errorMsg}</Text>
              </View>
            ) : null}

            {/* Scan button */}
            <TouchableOpacity
              style={[s.scanBtn, (scanning || connecting !== null) && s.btnDisabled]}
              onPress={handleScan}
              disabled={scanning || connecting !== null}
            >
              {scanning ? (
                <View style={s.btnRow}>
                  <ActivityIndicator color="#000" size="small" />
                  <Text style={s.scanBtnText}>
                    Scanning… ({devices.length} found)
                  </Text>
                </View>
              ) : (
                <Text style={s.scanBtnText}>⬡ Scan for Devices</Text>
              )}
            </TouchableOpacity>

            {/* Device list — populates live during scan */}
            {devices.length > 0 && (
              <View style={s.deviceList}>
                <Text style={s.deviceListHeader}>
                  Select BlowSafe to connect
                </Text>
                {devices.map(d => {
                  const isBlowSafe   = d.name.toLowerCase().includes("blowsafe");
                  const isConnecting = connecting === d.id;
                  return (
                    <TouchableOpacity
                      key={d.id}
                      style={[
                        s.deviceItem,
                        isBlowSafe   && s.deviceHighlight,
                        connecting !== null && s.deviceDisabled,
                      ]}
                      onPress={() => handleConnect(d)}
                      disabled={connecting !== null}
                    >
                      <View style={s.deviceLeft}>
                        <View style={s.deviceNameRow}>
                          <Text style={s.deviceName}>{d.name}</Text>
                          {isBlowSafe && (
                            <View style={s.deviceBadge}>
                              <Text style={s.deviceBadgeText}>BlowSafe</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.deviceId}>{d.id}</Text>
                        {isConnecting && <Text style={s.connectingLabel}>Connecting…</Text>}
                      </View>
                      <View style={s.deviceRight}>
                        {isConnecting
                          ? <ActivityIndicator color="#1DB954" size="small" />
                          : <Text style={s.connectArrow}>→</Text>
                        }
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {devices.length === 0 && !scanning && !scanErr && !isReconnecting && (
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>
                  Tap Scan for Devices to find your BlowSafe breathalyser.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── Connected ─────────────────────────────────────────────────── */}
        {isConnected && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Device Status</Text>
            <View style={s.statusRow}>
              <View style={[
                s.statusLed,
                isWarmup           && s.ledBlue,
                canScan            && s.ledGreen,
                isBacScan          && s.ledBlue,
                isRecal            && s.ledOrange,
                status === "error" && s.ledRed,
              ]} />
              <View style={{ flex: 1 }}>
                <Text style={s.statusLabel}>{statusLabel}</Text>
                {recalMsg ? <Text style={s.recalText}>{recalMsg}</Text> : null}
                {errorMsg ? <Text style={s.errorText}>{errorMsg}</Text>  : null}
              </View>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoText}>✓ Auto-reconnect enabled</Text>
              {battery > 0 && <Text style={s.infoText}>Battery: {battery}%</Text>}
            </View>
            <TouchableOpacity style={s.disconnectBtn} onPress={handleDisconnect}>
              <Text style={s.disconnectText}>Disconnect Device</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Result ────────────────────────────────────────────────────── */}
        {result && (
          <View style={[s.card, result.overLimit ? s.cardFail : s.cardPass]}>
            <View style={s.resultHeader}>
              <Text style={s.cardTitle}>Last Result</Text>
              <TouchableOpacity onPress={clearResult}>
                <Text style={s.clearText}>Clear</Text>
              </TouchableOpacity>
            </View>
            <View style={s.bacDisplay}>
              <Text style={[s.bacValue, result.overLimit ? s.textFail : s.textPass]}>
                {result.bacPercent}
              </Text>
              <Text style={s.bacMg}>{result.bacMg}</Text>
            </View>
            <View style={[s.verdictBox, result.overLimit ? s.verdictFail : s.verdictPass]}>
              <Text style={s.verdictText}>
                {result.overLimit ? "⚠  OVER LEGAL LIMIT — DO NOT DRIVE" : "✓  WITHIN LEGAL LIMIT"}
              </Text>
            </View>
            <Text style={s.legalNote}>Zimbabwe limit: 0.08% BAC (80 mg/100ml)</Text>
            <Text style={s.timestamp}>{new Date(result.timestamp).toLocaleTimeString()}</Text>
          </View>
        )}

        {/* ── History ───────────────────────────────────────────────────── */}
        {history.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Scan History</Text>
            {history.map((r, i) => (
              <View key={i} style={s.historyRow}>
                <View style={[s.historyDot, r.overLimit ? s.ledRed : s.ledGreen]} />
                <Text style={s.historyBac}>{r.bacPercent}</Text>
                <Text style={[s.historyStatus, r.overLimit ? s.textFail : s.textPass]}>
                  {r.status}
                </Text>
                <Text style={s.historyTime}>
                  {new Date(r.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const b = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 8 },
  body: { flexDirection: "row", alignItems: "center", gap: 2, borderWidth: 1, borderColor: "#444", borderRadius: 3, padding: 2 },
  bar:  { width: 5, height: 10, borderRadius: 1 },
  tip:  { width: 3, height: 6, borderWidth: 1, borderRadius: 1 },
  pct:  { fontSize: 10, fontWeight: "700" },
});

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#121212" },
  topBar:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  title:        { color: "#1DB954", fontSize: 16, fontWeight: "800" },
  topRight:     { flexDirection: "row", alignItems: "center" },
  pill:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  pillOn:       { borderColor: "rgba(29,185,84,0.3)",    backgroundColor: "rgba(29,185,84,0.08)" },
  pillOff:      { borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.03)" },
  pillDot:      { width: 6, height: 6, borderRadius: 3 },
  dotGreen:     { backgroundColor: "#1DB954" },
  dotGrey:      { backgroundColor: "#444" },
  pillText:     { fontSize: 10, fontWeight: "600" },
  pillTextOn:   { color: "#1DB954" },
  pillTextOff:  { color: "#555" },
  content:      { padding: 12, paddingBottom: 110 },
  card:         { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  cardFail:     { borderColor: "rgba(255,76,76,0.3)" },
  cardPass:     { borderColor: "rgba(29,185,84,0.3)" },
  cardTitle:    { color: "#1DB954", fontSize: 12, fontWeight: "700", marginBottom: 6 },
  cardSub:      { color: "#555", fontSize: 11, lineHeight: 17, marginBottom: 12 },
  highlight:    { color: "#1DB954", fontWeight: "600" },
  reconnectBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(29,185,84,0.08)", borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "rgba(29,185,84,0.2)" },
  reconnectText:{ color: "#1DB954", fontSize: 11, fontWeight: "600" },
  errorBox:     { backgroundColor: "rgba(255,76,76,0.08)", borderLeftWidth: 2, borderLeftColor: "#FF4C4C", borderRadius: 6, padding: 8, marginBottom: 10 },
  errorText:    { color: "#FF4C4C", fontSize: 11 },
  scanBtn:      { backgroundColor: "#1DB954", paddingVertical: 12, borderRadius: 22, alignItems: "center", marginBottom: 4 },
  btnDisabled:  { opacity: 0.5 },
  scanBtnText:  { color: "#000", fontWeight: "700", fontSize: 13 },
  btnRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  deviceList:   { marginTop: 12 },
  deviceListHeader: { color: "#555", fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  deviceItem:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#111", borderRadius: 8, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: "#222" },
  deviceHighlight: { borderColor: "rgba(29,185,84,0.4)", backgroundColor: "rgba(29,185,84,0.04)" },
  deviceDisabled:  { opacity: 0.4 },
  deviceLeft:   { flex: 1 },
  deviceNameRow:{ flexDirection: "row", alignItems: "center", gap: 8 },
  deviceName:   { color: "#fff", fontSize: 13, fontWeight: "600" },
  deviceBadge:  { backgroundColor: "rgba(29,185,84,0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: "rgba(29,185,84,0.3)" },
  deviceBadgeText: { color: "#1DB954", fontSize: 8, fontWeight: "700" },
  deviceId:     { color: "#444", fontSize: 9, marginTop: 3 },
  connectingLabel: { color: "#1DB954", fontSize: 9, marginTop: 3 },
  deviceRight:  { paddingLeft: 10 },
  connectArrow: { color: "#1DB954", fontSize: 18, fontWeight: "700" },
  emptyBox:     { marginTop: 12, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#222", borderStyle: "dashed" },
  emptyText:    { color: "#444", fontSize: 11, textAlign: "center", lineHeight: 18 },
  statusRow:    { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  statusLed:    { width: 12, height: 12, borderRadius: 6, backgroundColor: "#333" },
  ledGreen:     { backgroundColor: "#1DB954" },
  ledBlue:      { backgroundColor: "#1e90ff" },
  ledOrange:    { backgroundColor: "#f5a623" },
  ledRed:       { backgroundColor: "#FF4C4C" },
  statusLabel:  { color: "#fff", fontSize: 12, fontWeight: "600" },
  recalText:    { color: "#f5a623", fontSize: 10, marginTop: 2 },
  infoRow:      { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  infoText:     { color: "#1DB954", fontSize: 9, opacity: 0.7 },
  disconnectBtn:{ alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: "#2a2a2a" },
  disconnectText: { color: "#555", fontSize: 11 },
  resultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  clearText:    { color: "#444", fontSize: 11 },
  bacDisplay:   { alignItems: "center", paddingVertical: 14, gap: 2 },
  bacValue:     { fontSize: 44, fontWeight: "800", letterSpacing: 1 },
  bacMg:        { color: "#666", fontSize: 12 },
  textFail:     { color: "#FF4C4C" },
  textPass:     { color: "#1DB954" },
  verdictBox:   { borderRadius: 8, padding: 10, alignItems: "center", marginBottom: 8 },
  verdictFail:  { backgroundColor: "rgba(255,76,76,0.1)" },
  verdictPass:  { backgroundColor: "rgba(29,185,84,0.08)" },
  verdictText:  { color: "#fff", fontWeight: "700", fontSize: 12, textAlign: "center" },
  legalNote:    { color: "#444", fontSize: 10, textAlign: "center" },
  timestamp:    { color: "#333", fontSize: 9, textAlign: "center", marginTop: 3 },
  historyRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#1e1e1e" },
  historyDot:   { width: 8, height: 8, borderRadius: 4 },
  historyBac:   { color: "#fff", fontSize: 12, fontWeight: "600", flex: 1 },
  historyStatus:{ fontSize: 11, fontWeight: "700", width: 36 },
  historyTime:  { color: "#333", fontSize: 10 },
});