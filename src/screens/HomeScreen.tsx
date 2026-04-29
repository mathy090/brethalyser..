/**
 * src/screens/HomeScreen.tsx
 * Home screen - Driver management & Uploads (Bluetooth removed)
 */

import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, StatusBar,
  Image, TouchableOpacity, ScrollView,
} from "react-native";
import { SafeAreaView }     from "react-native-safe-area-context";
// Ensure this path is correct for your project structure
import { useOfficer }       from "../context/OfficerContext";
import { useNetworkStatus } from "../helpers/network";
import { useLiveClock }     from "../hooks/useLiveClock";
import { type DriverData }  from "../helpers/constants";
import DriverCard           from "../features/home/DriverCard";

export default function HomeScreen() {
  // ✅ Safety: If officer context is missing, we handle it gracefully
  const officerContext = useOfficer();
  const officer = officerContext?.officer; 
  
  const { isConnected }      = useNetworkStatus();
  const { date, time }       = useLiveClock();

  const [driverValid, setDriverValid] = useState(false);

  const handleDriverChange = useCallback(
    (_data: DriverData, isValid: boolean, _photoUri: string | null) => {
      setDriverValid(isValid);
    },
    []
  );

  const handleUpload = useCallback(() => {
    console.log("Upload pressed", officer ? "Logged in" : "Guest");
  }, [officer]);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />

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
        {/* ── Driver card ───────────────────────────────────────────────── */}
        <DriverCard onDataChange={handleDriverChange} />

        {/* ── Buttons ───────────────────────────────────────────────────── */}
        <View style={s.btnRow}>
          <TouchableOpacity
            style={[s.uploadBtn, !driverValid ? s.uploadBtnOff : null]}
            onPress={handleUpload}
            disabled={!driverValid}
            activeOpacity={0.85}
          >
            <Text style={[s.uploadBtnText, !driverValid ? s.uploadBtnTextOff : null]}>
              Upload Data
            </Text>
          </TouchableOpacity>
        </View>

        {!driverValid && (
          <Text style={s.uploadHint}>Scan driver licence to enable upload</Text>
        )}

        <Text style={s.legalNote}>
          Zimbabwe limit: 0.08% BAC · 80 mg/100ml · Road Traffic Act
        </Text>

      </ScrollView>
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
  btnRow:           { flexDirection: "row", gap: 12, marginBottom: 8, marginTop: 10 },
  uploadBtn:        { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#1DB954" },
  uploadBtnOff:     { borderColor: "#2a2a2a" },
  uploadBtnText:    { fontSize: 15, fontWeight: "700", color: "#1DB954" },
  uploadBtnTextOff: { color: "#333" },
  uploadHint:       { color: "#444", fontSize: 10, textAlign: "center", marginTop: 4 },
  legalNote:        { color: "#2a2a2a", fontSize: 9, textAlign: "center", marginTop: 12 },
});