/**
 * src/screens/HomeScreen.tsx
 * Simple manual entry – Name & ID only, plus BAC reading.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  StatusBar,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BACKEND_URL } from "@env";
import { useOfficer } from "../context/OfficerContext";
import { useNetworkStatus } from "../helpers/network";
import { useLiveClock } from "../hooks/useLiveClock";
import { useBreathalyser } from "../context/BreathalyserContext";
import { calculateFine } from "../helpers/fineCalculator";
import { getToken } from "../security/secureStorage";

// ── Upload error messages ──────────────────────────────
const UploadErrors = {
  missingFields: () =>
    "Please enter both driver name and ID number before uploading.",
  missingBac: () =>
    "A breathalyser reading is required before uploading a record.",
  invalidBackendUrl: () =>
    "Server address is not configured. Contact your administrator.",
  noNetwork: () =>
    "No internet connection. Connect to a network and try again.",
  timeout: () =>
    "The upload timed out. Check your connection and try again.",
  serverBadResponse: () =>
    "The server returned an unexpected response. Try again.",
  serverRejected: (detail?: string) =>
    detail ? `Upload rejected: ${detail}` : "The server rejected the upload.",
  unexpected: (detail?: string) =>
    detail ? `Unexpected error: ${detail}` : "An unexpected error occurred.",
} as const;

export default function HomeScreen() {
  const { officer } = useOfficer();
  const { isConnected } = useNetworkStatus();
  const { date, time } = useLiveClock();
  const { result: bacResult } = useBreathalyser();

  // Simple fields – name and ID only
  const [driverName, setDriverName] = useState("");
  const [idNumber, setIdNumber] = useState("");

  const [isUploading, setIsUploading] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { uploadAbortRef.current?.abort(); };
  }, []);

  // ── Upload readiness ───────────────────────────────
  const fieldsValid = driverName.trim() !== "" && idNumber.trim() !== "";
  const uploadReady = fieldsValid && !!bacResult && isConnected;

  // ── Upload logic ───────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!fieldsValid) {
      Alert.alert("Missing Fields", UploadErrors.missingFields());
      return;
    }
    if (!bacResult) {
      Alert.alert("BAC Reading Required", UploadErrors.missingBac());
      return;
    }

    const cleanBaseUrl = BACKEND_URL?.trim();
    if (!cleanBaseUrl || !cleanBaseUrl.startsWith("http")) {
      Alert.alert("Configuration Error", UploadErrors.invalidBackendUrl());
      return;
    }
    if (!isConnected) {
      Alert.alert("No Connection", UploadErrors.noNetwork());
      return;
    }

    setIsUploading(true);
    uploadAbortRef.current = new AbortController();
    const timeoutHandle = setTimeout(() => {
      uploadAbortRef.current?.abort();
    }, 30_000);

    try {
      const token = await getToken();
      const bacValue = parseFloat(bacResult.bacPercent.replace("%", ""));
      const fineInfo = calculateFine(bacValue);

      // Build the simple payload
      const payload = {
        name: driverName.trim(),
        idNumber: idNumber.trim(),
        bac: bacValue.toFixed(3),
        fine: fineInfo?.amount ?? 0,
        category: fineInfo?.description ?? "N/A",
        overLimit: bacResult.overLimit,
        timestamp: bacResult.timestamp,
        officerId: officer?.officerId ?? "UNKNOWN",
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const response = await fetch(`${cleanBaseUrl}/api/record`, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: uploadAbortRef.current.signal,
        headers,
      });

      clearTimeout(timeoutHandle);

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("NON_JSON");
      }

      const body = await response.json();
      if (!response.ok) {
        const detail = body?.error ?? body?.message ?? body?.details;
        throw new Error(`SERVER:${detail ?? response.status}`);
      }

      Alert.alert(
        "Record Saved ✓",
        `Name: ${payload.name}\nID: ${payload.idNumber}\nBAC: ${bacResult.bacPercent}\nFine: $${payload.fine}`
      );
    } catch (err: any) {
      clearTimeout(timeoutHandle);

      let message: string;
      if (err.name === "AbortError") {
        message = UploadErrors.timeout();
      } else if (err.message === "NON_JSON") {
        message = UploadErrors.serverBadResponse();
      } else if (
        err.message?.includes("Network request failed") ||
        err.message?.includes("Failed to fetch")
      ) {
        message = UploadErrors.noNetwork();
      } else if (err.message?.startsWith("SERVER:")) {
        message = UploadErrors.serverRejected(err.message.slice(7));
      } else {
        message = UploadErrors.unexpected(err.message);
      }

      Alert.alert("Upload Failed", message);
    } finally {
      setIsUploading(false);
      uploadAbortRef.current = null;
    }
  }, [fieldsValid, bacResult, isConnected, officer, driverName, idNumber]);

  // ── Derived ──────────────────────────────────────────
  const fineInfo = bacResult
    ? calculateFine(parseFloat(bacResult.bacPercent.replace("%", "")))
    : null;

  const uploadButtonDisabled = !uploadReady || isUploading;

  // ── Render ───────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />

      {/* Top bar */}
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
          <View
            style={[
              s.statusDot,
              { backgroundColor: isConnected ? "#1DB954" : "#FF4C4C" },
            ]}
          />
          <Text
            style={[
              s.statusText,
              { color: isConnected ? "#1DB954" : "#FF4C4C" },
            ]}
          >
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
        {/* ── Simple Entry Card ── */}
        <View style={s.formCard}>
          <Text style={s.formTitle}>Driver Details</Text>

          <Text style={s.label}>Full Name</Text>
          <TextInput
            style={s.input}
            value={driverName}
            onChangeText={setDriverName}
            placeholder="e.g. John Doe"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>ID Number</Text>
          <TextInput
            style={s.input}
            value={idNumber}
            onChangeText={setIdNumber}
            placeholder="e.g. 63-1234567A12"
            placeholderTextColor="#555"
          />
        </View>

        {/* BAC result */}
        {bacResult && (
          <View style={s.bacSection}>
            <Text style={s.sectionLabel}>LATEST READING</Text>
            <View style={s.bacCard}>
              <View
                style={[
                  s.bacDot,
                  { backgroundColor: bacResult.overLimit ? "#FF4C4C" : "#1DB954" },
                ]}
              />
              <Text
                style={[
                  s.bacValue,
                  { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" },
                ]}
              >
                {bacResult.bacPercent}
              </Text>
              <Text style={s.bacTime}>
                {new Date(bacResult.timestamp).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
              {fineInfo && (
                <View style={s.fineWrap}>
                  <Text style={s.fineLabel}>Fine</Text>
                  <Text
                    style={[
                      s.fineValue,
                      { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" },
                    ]}
                  >
                    ${fineInfo.amount}
                  </Text>
                </View>
              )}
              <Text
                style={[
                  s.bacStatus,
                  { color: bacResult.overLimit ? "#FF4C4C" : "#1DB954" },
                ]}
              >
                {bacResult.overLimit ? "OVER LIMIT" : "PASS"}
              </Text>
            </View>
            {fineInfo && bacResult.overLimit && (
              <Text style={s.fineDesc}>Category: {fineInfo.description}</Text>
            )}
          </View>
        )}

        {/* Upload button */}
        <TouchableOpacity
          style={[s.uploadBtn, uploadButtonDisabled && s.uploadBtnOff]}
          onPress={handleUpload}
          disabled={uploadButtonDisabled}
          activeOpacity={0.85}
        >
          {isUploading ? (
            <View style={s.uploadRow}>
              <ActivityIndicator color="#1DB954" size="small" />
              <Text style={[s.uploadText, { color: "#1DB954" }]}>
                Uploading…
              </Text>
            </View>
          ) : (
            <Text
              style={[
                s.uploadText,
                { color: uploadButtonDisabled ? "#333" : "#1DB954" },
              ]}
            >
              Save Record
            </Text>
          )}
        </TouchableOpacity>

        {/* Hints */}
        {!fieldsValid && (
          <Text style={s.hint}>Enter driver name and ID number</Text>
        )}
        {fieldsValid && !bacResult && (
          <Text style={s.hint}>Capture a BAC reading to enable upload</Text>
        )}

        <Text style={s.legalNote}>
          Zimbabwe limit: 0.08% BAC · 80 mg/100ml · Road Traffic Act
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#121212",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "#1DB954",
  },
  logo: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  island: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  islandName: {
    color: "#1DB954",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  islandDivider: {
    width: 1,
    height: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  islandClock: {
    alignItems: "flex-start",
  },
  islandTime: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  islandDate: {
    color: "#555",
    fontSize: 9,
    fontWeight: "500",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    width: 64,
    justifyContent: "flex-end",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
  },
  scroll: { flex: 1 },
  content: {
    padding: 12,
    paddingBottom: 40,
  },
  formCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  formTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  label: {
    color: "#888",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#111",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "500",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  bacSection: {
    marginTop: 4,
    marginBottom: 8,
  },
  sectionLabel: {
    color: "#444",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  bacCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  bacDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  bacValue: {
    width: 50,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  bacTime: {
    color: "#666",
    fontSize: 12,
    fontWeight: "500",
    marginRight: 8,
  },
  fineWrap: {
    marginRight: 8,
    alignItems: "flex-start",
  },
  fineLabel: {
    color: "#888",
    fontSize: 9,
    fontWeight: "600",
  },
  fineValue: {
    fontSize: 14,
    fontWeight: "800",
  },
  bacStatus: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    flex: 1,
    textAlign: "right",
  },
  fineDesc: {
    color: "#FFA500",
    fontSize: 10,
    marginTop: 4,
    marginLeft: 22,
    fontStyle: "italic",
  },
  uploadBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#1DB954",
    marginTop: 10,
    marginBottom: 8,
  },
  uploadBtnOff: {
    borderColor: "#2a2a2a",
  },
  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  uploadText: {
    fontSize: 15,
    fontWeight: "700",
  },
  hint: {
    color: "#444",
    fontSize: 10,
    textAlign: "center",
    marginTop: 4,
  },
  legalNote: {
    color: "#2a2a2a",
    fontSize: 9,
    textAlign: "center",
    marginTop: 12,
  },
});