

import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, StatusBar,
  Image, TouchableOpacity, ScrollView,
} from "react-native";
import { SafeAreaView }     from "react-native-safe-area-context";
import { useOfficer }       from "../context/OfficerContext";
import { useNetworkStatus } from "../helpers/network";
import { useLiveClock }     from "../hooks/useLiveClock";
import { type DriverData }  from "../helpers/constants";
import DriverCard           from "../features/home/DriverCard";
import { useBreathalyser }  from "../context/BreathalyserContext";
import { calculateFine }    from "../helpers/fineCalculator"; // 🔧 Import Fine Logic

export default function HomeScreen() {
  const officerContext = useOfficer();
  const officer = officerContext?.officer; 
  
  const { isConnected }      = useNetworkStatus();
  const { date, time }       = useLiveClock();
  
  // Get latest BAC result from context
  const { result: bacResult } = useBreathalyser();

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

  // Calculate Fine if result exists
  const fineInfo = bacResult ? calculateFine(parseFloat(bacResult.bacPercent)) : null;

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

        {/* ── BAC Result Summary (Auto-updates after scan) ──────────────── */}
        {bacResult && (
          <View style={s.bacSection}>
            <Text style={s.sectionLabel}>LATEST READING</Text>
            <View style={s.bacRow}>
              {/* 1. Dot Indicator */}
              <View style={[s.bacDot, { backgroundColor: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]} />
              
              {/* 2. BAC Percentage */}
              <Text style={[s.bacValue, { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                {bacResult.bacPercent}
              </Text>
              
              {/* 3. Time */}
              <Text style={s.bacTime}>
                {new Date(bacResult.timestamp).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>

              {/* 🔧 4. Estimated Fine (Inserted between Time and Status) */}
              {fineInfo && (
                <View style={s.fineContainer}>
                  <Text style={s.fineLabel}>Fine:</Text>
                  <Text style={[s.fineValue, { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                    ${fineInfo.amount}
                  </Text>
                </View>
              )}
              
              {/* 5. Status (PASS/FAIL) */}
              <Text style={[s.bacStatus, { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                {bacResult.overLimit ? "OVER LIMIT" : "PASS"}
              </Text>
            </View>
            
            {/* Optional: Show fine description below if over limit */}
            {fineInfo && bacResult.overLimit && (
              <Text style={s.fineDescription}>
                Category: {fineInfo.description}
              </Text>
            )}
          </View>
        )}

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
  
  // ── BAC Section Styles ──────────────────────────────────────────────────
  bacSection:      { marginTop: 16, marginBottom: 8 },
  sectionLabel:    { color: "#444", fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8, marginLeft: 4 },
  bacRow:          { flexDirection: "row", alignItems: "center", backgroundColor: "#1a1a1a", paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  bacDot:          { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  bacValue:        { width: 50, fontSize: 16, fontWeight: "800", letterSpacing: 0.5 },
  bacTime:         { color: "#666", fontSize: 12, fontWeight: "500", marginRight: 8, fontVariant: ["tabular-nums"] },
  
  // 🔧 Fine Styles
  fineContainer:   { marginRight: 8, alignItems: "flex-start" },
  fineLabel:       { color: "#888", fontSize: 9, fontWeight: "600" },
  fineValue:       { fontSize: 14, fontWeight: "800" },
  
  bacStatus:       { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, width: 70, textAlign: "right" },
  fineDescription: { color: "#FFA500", fontSize: 10, marginTop: 4, marginLeft: 22, fontStyle: "italic" },

  // ── Button Styles ───────────────────────────────────────────────────────
  btnRow:           { flexDirection: "row", gap: 12, marginBottom: 8, marginTop: 10 },
  uploadBtn:        { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#1DB954" },
  uploadBtnOff:     { borderColor: "#2a2a2a" },
  uploadBtnText:    { fontSize: 15, fontWeight: "700", color: "#1DB954" },
  uploadBtnTextOff: { color: "#333" },
  uploadHint:       { color: "#444", fontSize: 10, textAlign: "center", marginTop: 4 },
  legalNote:        { color: "#2a2a2a", fontSize: 9, textAlign: "center", marginTop: 12 },
});