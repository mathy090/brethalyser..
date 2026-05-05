/**
 * src/screens/HomeScreen.tsx
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  View,
  Text,
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
import { type DriverData } from "../helpers/constants";
import DriverCard from "../features/home/DriverCard";
import { useBreathalyser } from "../context/BreathalyserContext";
import { calculateFine } from "../helpers/fineCalculator";
import { getToken } from "../security/secureStorage";

// ─── Upload error messages ────────────────────────────────────────────────────

const UploadErrors = {
  missingDriver: () =>
    "Scan the driver licence and ensure all fields are present before uploading.",
  missingBac: () =>
    "A breathalyser reading is required before uploading a record.",
  photoNotReady: () =>
    "The licence photo is still loading. Wait a moment and try again.",
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

// ─── Read photo into Blob (Android content:// safe) ───────────────────────────

function readFileAsBlob(uri: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", uri, true);
    xhr.responseType = "blob";
    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response instanceof Blob) {
        resolve(xhr.response);
      } else {
        reject(new Error(`XHR failed: status=${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("XHR network error"));
    xhr.ontimeout = () => reject(new Error("XHR timeout"));
    xhr.timeout = 8_000;
    xhr.send();
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { officer } = useOfficer();
  const { isConnected } = useNetworkStatus();
  const { date, time } = useLiveClock();
  const { result: bacResult } = useBreathalyser();

  const [driverValid, setDriverValid] = useState(false);
  const [driverData, setDriverData] = useState<DriverData | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isBlobLoading, setIsBlobLoading] = useState(false);
  const [showOcrBanner, setShowOcrBanner] = useState(false);

  const photoBlobRef = useRef<Blob | "error" | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { uploadAbortRef.current?.abort(); };
  }, []);

  // ── Pre-cache photo blob after OCR ──────────────────────────────────────────

  const precachePhotoBlob = useCallback((uri: string) => {
    photoBlobRef.current = null;
    setIsBlobLoading(true);

    readFileAsBlob(uri)
      .then((blob) => {
        photoBlobRef.current = blob;
        setIsBlobLoading(false);
      })
      .catch((err) => {
        photoBlobRef.current = "error";
        setIsBlobLoading(false);
        console.warn("[HomeScreen] Photo blob failed:", err.message);
      });
  }, []);

  // ── DriverCard callback ──────────────────────────────────────────────────────

  const handleDriverChange = useCallback(
    (data: DriverData, isValid: boolean, uri: string | null) => {
      setDriverValid(isValid);
      setDriverData(data);
      setPhotoUri(uri);
      setShowOcrBanner(true); // always show banner after any OCR result

      if (uri) {
        precachePhotoBlob(uri);
      } else {
        photoBlobRef.current = null;
        setIsBlobLoading(false);
      }
    },
    [precachePhotoBlob]
  );

  // ── Upload ───────────────────────────────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    if (!driverValid || !driverData) {
      Alert.alert("Driver Details Required", UploadErrors.missingDriver());
      return;
    }
    if (!bacResult) {
      Alert.alert("BAC Reading Required", UploadErrors.missingBac());
      return;
    }
    if (isBlobLoading) {
      Alert.alert("Photo Loading", UploadErrors.photoNotReady());
      return;
    }
    if (!(photoBlobRef.current instanceof Blob)) {
      Alert.alert("Photo Unavailable", "Rescan the licence to retry.");
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

      const formData = new FormData();

      formData.append("driverData", JSON.stringify({
        surname:       driverData.surname,
        firstName:     driverData.firstName,
        dateOfBirth:   driverData.dateOfBirth,
        gender:        driverData.gender,
        idNumber:      driverData.idNumber,
        licenceNumber: driverData.licenceNumber,
        licenceCode:   driverData.licenceCode,
        issueDate:     driverData.issueDate,
        expiryDate:    driverData.expiryDate,
      }));

      formData.append("bacData", JSON.stringify({
        bac:       bacValue.toFixed(3),
        timestamp: bacResult.timestamp,
        overLimit: bacResult.overLimit,
        fine:      fineInfo?.amount ?? 0,
        category:  fineInfo?.description ?? "N/A",
        officerId: officer?.officerId ?? "UNKNOWN",
      }));

      formData.append(
        "photo",
        photoBlobRef.current as Blob,
        `licence-${driverData.idNumber.replace(/\//g, "_")}.jpg`
      );

      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const response = await fetch(`${cleanBaseUrl}/api/upload`, {
        method: "POST",
        body:   formData,
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
        "Record Uploaded ✓",
        [
          `Officer:  ${officer?.officerId ?? "—"}`,
          `Driver:   ${driverData.firstName} ${driverData.surname}`,
          `ID:       ${driverData.idNumber}`,
          `BAC:      ${bacResult.bacPercent}`,
          `Fine:     $${fineInfo?.amount ?? 0}`,
        ].join("\n")
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
  }, [
    driverValid,
    driverData,
    bacResult,
    isBlobLoading,
    isConnected,
    officer,
  ]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const fineInfo = bacResult
    ? calculateFine(parseFloat(bacResult.bacPercent.replace("%", "")))
    : null;

  const uploadReady =
    driverValid &&
    !!bacResult &&
    !isBlobLoading &&
    photoBlobRef.current instanceof Blob;

  const uploadButtonDisabled = !uploadReady || isUploading;

  // ── Render ───────────────────────────────────────────────────────────────────

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
        {/* OCR warning banner — shown after any scan result */}
        {showOcrBanner && (
          <View style={s.ocrBanner}>
            <Text style={s.ocrBannerIcon}>⚠️</Text>
            <Text style={s.ocrBannerText}>
              AI extraction is not perfect. Carefully check and correct
              every field to match the physical licence before uploading.
            </Text>
            <TouchableOpacity
              onPress={() => setShowOcrBanner(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.ocrBannerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Driver card */}
        <DriverCard onDataChange={handleDriverChange} />

        {/* Photo blob loading indicator */}
        {isBlobLoading && (
          <View style={s.blobRow}>
            <ActivityIndicator size="small" color="#1DB954" />
            <Text style={s.blobText}>Securing photo for upload…</Text>
          </View>
        )}

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
                  hour:   "2-digit",
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
          ) : isBlobLoading ? (
            <View style={s.uploadRow}>
              <ActivityIndicator color="#555" size="small" />
              <Text style={[s.uploadText, { color: "#555" }]}>
                Preparing…
              </Text>
            </View>
          ) : (
            <Text
              style={[
                s.uploadText,
                { color: uploadButtonDisabled ? "#333" : "#1DB954" },
              ]}
            >
              Upload Record
            </Text>
          )}
        </TouchableOpacity>

        {/* Upload hints */}
        {!driverValid && !isBlobLoading && (
          <Text style={s.hint}>Scan driver licence to enable upload</Text>
        )}
        {driverValid && !bacResult && (
          <Text style={s.hint}>
            Capture a BAC reading to complete the record
          </Text>
        )}

        <Text style={s.legalNote}>
          Zimbabwe limit: 0.08% BAC · 80 mg/100ml · Road Traffic Act
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#121212",
  },

  // top bar
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

  // scroll
  scroll: { flex: 1 },
  content: {
    padding: 12,
    paddingBottom: 40,
  },

  // OCR banner
  ocrBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(220, 38, 38, 0.12)",
    borderLeftWidth: 4,
    borderLeftColor: "#DC2626",
    borderRadius: 8,
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  ocrBannerIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  ocrBannerText: {
    flex: 1,
    color: "#FCA5A5",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },
  ocrBannerClose: {
    color: "#DC2626",
    fontSize: 16,
    fontWeight: "700",
    paddingLeft: 4,
  },

  // blob loading
  blobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  blobText: {
    color: "#555",
    fontSize: 11,
  },

  // BAC section
  bacSection: {
    marginTop: 16,
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

  // upload
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