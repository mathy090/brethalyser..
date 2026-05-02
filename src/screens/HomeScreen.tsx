/**
 * src/screens/HomeScreen.tsx
 * Home screen - Driver management, BAC Result Display & Uploads
 */

import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, StatusBar,
  Image, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
// 🔧 Import backend URL using react-native-dotenv
import { BACKEND_URL } from '@env';
import { useOfficer } from "../context/OfficerContext";
import { useNetworkStatus } from "../helpers/network";
import { useLiveClock } from "../hooks/useLiveClock";
import { type DriverData } from "../helpers/constants";
import DriverCard from "../features/home/DriverCard";
import { useBreathalyser } from "../context/BreathalyserContext";
import { calculateFine } from "../helpers/fineCalculator";

export default function HomeScreen() {
  // ✅ ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
  const officerContext = useOfficer();
  const officer = officerContext?.officer ?? null;
  
  const { isConnected } = useNetworkStatus();
  const { date, time } = useLiveClock();
  const { result: bacResult } = useBreathalyser();

  // Local UI State
  const [driverValid, setDriverValid] = useState(false);
  const [driverData, setDriverData] = useState<DriverData | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Capture driver data & photo from DriverCard
  const handleDriverChange = useCallback(
    (data: DriverData, isValid: boolean, uri: string | null) => {
      setDriverValid(isValid);
      setDriverData(data);
      setPhotoUri(uri);
    },
    []
  );

  // Upload Handler
  const handleUpload = useCallback(async () => {
  const cleanBackendUrl = BACKEND_URL?.trim();

  if (!cleanBackendUrl || !cleanBackendUrl.startsWith("http")) {
    Alert.alert("Config Error", "Invalid BACKEND_URL");
    return;
  }

  if (!driverValid || !bacResult || !photoUri || !driverData) {
    Alert.alert("Missing Info", "Complete all required fields first");
    return;
  }

  setIsUploading(true);

  try {
    const formData = new FormData();

    // Driver data
    formData.append("driverData", JSON.stringify(driverData));

    // BAC data
    const bacValue = parseFloat(bacResult.bacPercent.replace("%", ""));
    const fineInfo = calculateFine(bacValue);

    formData.append(
      "bacData",
      JSON.stringify({
        bac: bacValue.toFixed(2),
        timestamp: bacResult.timestamp,
        fine: fineInfo?.amount || 0,
        overLimit: bacResult.overLimit,
      })
    );

    // Image file
    const fileResponse = await fetch(photoUri);
    const fileBlob = await fileResponse.blob();

    formData.append("photo", fileBlob as any, "driver.jpg");

   const uploadUrl = `${BACKEND_URL}/api/upload`;

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });

    const text = await response.text();

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("Server returned invalid response");
    }

    if (!response.ok) {
      throw new Error(result?.error || `Upload failed (${response.status})`);
    }

    Alert.alert(
      "Upload Successful",
      `Driver: ${driverData.firstName} ${driverData.surname}\nBAC: ${bacResult.bacPercent}`
    );
  } catch (err: any) {
    const msg =
      err?.message?.includes("Network request failed")
        ? "Cannot reach server (check backend or Render sleep)"
        : err.message;

    Alert.alert("Upload Failed", msg);
  } finally {
    setIsUploading(false);
  }
}, [driverValid, bacResult, photoUri, driverData]);

  // Calculate fine for UI display
  const fineInfo = bacResult ? calculateFine(parseFloat(bacResult.bacPercent.replace("%", ""))) : null;

  // ✅ RENDER LOGIC BELOW ALL HOOKS
  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <View style={s.topBar}>
        <View style={s.logoWrap}>
          <Image source={require("../../assets/background.png")} style={s.logo} />
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
          <View style={[s.statusDot, { backgroundColor: isConnected ? "#1DB954" : "#FF4C4C" }]} />
          <Text style={[s.statusText, { color: isConnected ? "#1DB954" : "#FF4C4C" }]}>
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

        {/* ── BAC Result Summary ──────────────────────────────────────── */}
        {bacResult && (
          <View style={s.bacSection}>
            <Text style={s.sectionLabel}>LATEST READING</Text>
            <View style={s.bacRow}>
              {/* Dot Indicator */}
              <View style={[s.bacDot, { backgroundColor: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]} />
              
              {/* BAC Percentage */}
              <Text style={[s.bacValue, { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                {bacResult.bacPercent}
              </Text>
              
              {/* Time */}
              <Text style={s.bacTime}>
                {new Date(bacResult.timestamp).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>

              {/* Fine Calculation */}
              {fineInfo && (
                <View style={s.fineContainer}>
                  <Text style={s.fineLabel}>Fine:</Text>
                  <Text style={[s.fineValue, { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                    ${fineInfo.amount}
                  </Text>
                </View>
              )}
              
              {/* Status */}
              <Text style={[s.bacStatus, { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" }]}>
                {bacResult.overLimit ? "OVER LIMIT" : "PASS"}
              </Text>
            </View>
            
            {/* Fine Description (if over limit) */}
            {fineInfo && bacResult.overLimit && (
              <Text style={s.fineDescription}>Category: {fineInfo.description}</Text>
            )}
          </View>
        )}

        {/* ── Upload Button ───────────────────────────────────────────── */}
        <View style={s.btnRow}>
          <TouchableOpacity
            style={[s.uploadBtn, (!driverValid || isUploading) ? s.uploadBtnOff : null]}
            onPress={handleUpload}
            disabled={!driverValid || isUploading}
            activeOpacity={0.85}
          >
            {isUploading ? (
              <ActivityIndicator color="#1DB954" />
            ) : (
              <Text style={[s.uploadBtnText, !driverValid ? s.uploadBtnTextOff : null]}>
                Upload Data
              </Text>
            )}
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
  root: { flex: 1, backgroundColor: "#121212" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  logoWrap: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", borderWidth: 1.5, borderColor: "#1DB954" },
  logo: { width: "100%", height: "100%", resizeMode: "cover" },
  island: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a1a1a", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 30, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", elevation: 6 },
  islandName: { color: "#1DB954", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  islandDivider: { width: 1, height: 14, backgroundColor: "rgba(255,255,255,0.1)" },
  islandClock: { alignItems: "flex-start" },
  islandTime: { color: "#fff", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: 0.5 },
  islandDate: { color: "#555", fontSize: 9, fontWeight: "500" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, width: 64, justifyContent: "flex-end" },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: 10, fontWeight: "700" },
  scroll: { flex: 1 },
  content: { padding: 12, paddingBottom: 40 },
  
  // BAC Row Styles
  bacSection: { marginTop: 16, marginBottom: 8 },
  sectionLabel: { color: "#444", fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8, marginLeft: 4 },
  bacRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#1a1a1a", paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  bacDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  bacValue: { width: 50, fontSize: 16, fontWeight: "800", letterSpacing: 0.5 },
  bacTime: { color: "#666", fontSize: 12, fontWeight: "500", marginRight: 8, fontVariant: ["tabular-nums"] },
  
  // Fine Styles
  fineContainer: { marginRight: 8, alignItems: "flex-start" },
  fineLabel: { color: "#888", fontSize: 9, fontWeight: "600" },
  fineValue: { fontSize: 14, fontWeight: "800" },
  bacStatus: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, width: 70, textAlign: "right" },
  fineDescription: { color: "#FFA500", fontSize: 10, marginTop: 4, marginLeft: 22, fontStyle: "italic" },

  // Button Styles
  btnRow: { flexDirection: "row", gap: 12, marginBottom: 8, marginTop: 10 },
  uploadBtn: { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#1DB954" },
  uploadBtnOff: { borderColor: "#2a2a2a" },
  uploadBtnText: { fontSize: 15, fontWeight: "700", color: "#1DB954" },
  uploadBtnTextOff: { color: "#333" },
  uploadHint: { color: "#444", fontSize: 10, textAlign: "center", marginTop: 4 },
  legalNote: { color: "#2a2a2a", fontSize: 9, textAlign: "center", marginTop: 12 },
});