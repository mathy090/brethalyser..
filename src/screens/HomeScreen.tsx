/**
 * src/screens/HomeScreen.tsx
 *
 * Home screen — Driver management, BAC result display & record upload.
 *
 * Photo pre-caching strategy
 * ──────────────────────────
 * Vision Camera writes photos to the OS temp/cache directory. That file is
 * valid immediately after capture but may be purged before the officer
 * triggers the upload (background GC, low-disk pressure, etc.).
 *
 * To guarantee the photo is always available at upload time we read it into
 * a Blob immediately after OCR completes, using XMLHttpRequest — the only
 * reliable way to read file:// URIs as binary in React Native on both
 * Android and iOS. The resulting Blob lives in JS heap and survives any
 * temp-file cleanup. It is appended to FormData at upload time.
 *
 * If blaob loading fails (edge-case) we surface a clear error to the officer
 * before ever touching the network — no silent phantom uploads.
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

// ─── Upload error catalogue ──────────────────────────────────────────────────
// Every user-facing error message lives here so wording is consistent and
// easy to update in one place.

const UploadErrors = {
  missingDriver: (): string =>
    "Scan the driver licence and ensure all fields are present before uploading.",

  missingBac: (): string =>
    "A breathalyser reading is required before uploading a record.",

  photoNotReady: (): string =>
    "The licence photo is still loading. Wait a moment and try again.",

  photoLoadFailed: (): string =>
    "Could not read the captured licence photo. Please retake the scan and try again.",

  invalidBackendUrl: (): string =>
    "Server address is not configured correctly. Contact your administrator.",

  noNetwork: (): string =>
    "No internet connection detected. Connect to a network and try again.",

  timeout: (): string =>
    "The upload timed out. Check your connection and try again.",

  serverBadResponse: (): string =>
    "The server returned an unexpected response. Try again or contact support.",

  serverRejected: (detail?: string): string =>
    detail
      ? `Upload rejected: ${detail}`
      : "The server rejected the upload. Please try again.",

  unexpected: (detail?: string): string =>
    detail
      ? `Unexpected error: ${detail}`
      : "An unexpected error occurred. Please try again.",
} as const;

// ─── Photo blob pre-caching ──────────────────────────────────────────────────
// fetch() does not reliably resolve file:// URIs on Android in React Native.
// XMLHttpRequest with responseType 'blob' does — this is the supported path.

function readFileAsBlob(uri: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", uri, true);
    xhr.responseType = "blob";

    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response instanceof Blob) {
        resolve(xhr.response);
      } else {
        reject(
          new Error(
            `XHR failed: status=${xhr.status}, type=${typeof xhr.response}`,
          ),
        );
      }
    };

    xhr.onerror = () =>
      reject(new Error("XHR network error reading local file"));
    xhr.ontimeout = () =>
      reject(new Error("XHR timeout reading local file"));

    xhr.timeout = 8_000; // 8 s is generous for a local file read
    xhr.send();
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { officer } = useOfficer();
  const { isConnected } = useNetworkStatus();
  const { date, time } = useLiveClock();
  const { result: bacResult } = useBreathalyser();

  // Driver state — populated by DriverCard after OCR + manual corrections
  const [driverValid, setDriverValid] = useState(false);
  const [driverData, setDriverData] = useState<DriverData | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);

  // Photo blob pre-cache — "true" means loading is in flight
  // null = no photo yet | Blob = ready | "error" = load failed
  const photoBlobRef = useRef<Blob | "error" | null>(null);
  const [isBlobLoading, setIsBlobLoading] = useState(false);

  // Active upload abort controller so we can cancel on unmount
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
  }, []);

  // ── Photo pre-caching ────────────────────────────────────────────────────
  // Called synchronously from onDataChange; the XHR runs asynchronously.
  // We intentionally do NOT await here — state updates stay synchronous so
  // the UI (DriverCard fields) renders immediately.

  const precachePhotoBlob = useCallback((uri: string) => {
    photoBlobRef.current = null;
    setIsBlobLoading(true);

    readFileAsBlob(uri)
      .then((blob) => {
        photoBlobRef.current = blob;
        setIsBlobLoading(false);
        console.log(
          `[HomeScreen] Photo blob cached — ${(blob.size / 1024).toFixed(1)} KB`,
        );
      })
      .catch((err) => {
        photoBlobRef.current = "error";
        setIsBlobLoading(false);
        console.warn("[HomeScreen] Photo blob pre-cache failed:", err.message);
      });
  }, []);

  // ── Driver data change handler ───────────────────────────────────────────
  // Signature matches DriverCard's onDataChange prop.

  const handleDriverChange = useCallback(
    (data: DriverData, isValid: boolean, uri: string | null) => {
      setDriverValid(isValid);
      setDriverData(data);
      setPhotoUri(uri);

      if (uri) {
        precachePhotoBlob(uri);
      } else {
        // Card was cleared — discard any cached blob
        photoBlobRef.current = null;
        setIsBlobLoading(false);
      }
    },
    [precachePhotoBlob],
  );

  // ── Upload record ────────────────────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    // ── Pre-flight validation ──────────────────────────────────────────────

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

    if (!photoBlobRef.current || photoBlobRef.current === "error") {
      Alert.alert("Photo Unavailable", UploadErrors.photoLoadFailed());
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

    // ── Build payload ──────────────────────────────────────────────────────

    setIsUploading(true);
    uploadAbortRef.current = new AbortController();

    const timeoutHandle = setTimeout(() => {
      uploadAbortRef.current?.abort();
    }, 30_000); // 30 s — generous for image upload on mobile networks

    try {
      const token = await getToken();

      const bacValue = parseFloat(bacResult.bacPercent.replace("%", ""));
      const fineInfo = calculateFine(bacValue);

      const formData = new FormData();

      // ── OCR-extracted driver record ──────────────────────────────────────
      // Includes every field from the Zimbabwe licence — all extracted text
      // plus any manual corrections the officer made in the DriverCard.
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

      // ── BAC reading ──────────────────────────────────────────────────────
      formData.append("bacData", JSON.stringify({
        bac:       bacValue.toFixed(3),
        timestamp: bacResult.timestamp,
        overLimit: bacResult.overLimit,
        fine:      fineInfo?.amount ?? 0,
        category:  fineInfo?.description ?? "N/A",
        officerId: officer?.officerId ?? "UNKNOWN",
      }));

      // ── Pre-cached photo blob ────────────────────────────────────────────
      // photoBlobRef.current is confirmed to be a Blob here (checked above).
      // React Native FormData accepts (Blob, filename) since RN 0.54+.
      formData.append(
        "photo",
        photoBlobRef.current as Blob,
        `licence-${driverData.idNumber.replace(/\//g, "_")}.jpg`,
      );

      // ── Request ──────────────────────────────────────────────────────────

      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(`${cleanBaseUrl}/api/upload`, {
        method:  "POST",
        body:    formData,
        signal:  uploadAbortRef.current.signal,
        headers,
      });

      clearTimeout(timeoutHandle);

      // ── Response handling ────────────────────────────────────────────────

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("NON_JSON");
      }

      const body = await response.json();

      if (!response.ok) {
        const detail: string | undefined =
          body?.error ?? body?.message ?? body?.details;
        throw new Error(`SERVER:${detail ?? response.status}`);
      }

      Alert.alert(
        "Record Uploaded",
        [
          `Officer:  ${officer?.officerId ?? "—"}`,
          `Driver:   ${driverData.firstName} ${driverData.surname}`,
          `ID:       ${driverData.idNumber}`,
          `BAC:      ${bacResult.bacPercent}`,
          `Fine:     $${fineInfo?.amount ?? 0}`,
        ].join("\n"),
      );
    } catch (err: any) {
      clearTimeout(timeoutHandle);

      let title   = "Upload Failed";
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

      Alert.alert(title, message);
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

  // ── Derived values ───────────────────────────────────────────────────────

  const fineInfo = bacResult
    ? calculateFine(parseFloat(bacResult.bacPercent.replace("%", "")))
    : null;

  const uploadReady =
    driverValid &&
    !!bacResult &&
    !isBlobLoading &&
    photoBlobRef.current instanceof Blob;

  const uploadButtonDisabled = !uploadReady || isUploading;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
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
        {/* ── Driver card ─────────────────────────────────────────────────── */}
        <DriverCard onDataChange={handleDriverChange} />

        {/* ── Photo loading indicator ──────────────────────────────────────── */}
        {isBlobLoading && (
          <View style={s.blobLoadingRow}>
            <ActivityIndicator size="small" color="#1DB954" />
            <Text style={s.blobLoadingText}>Securing photo for upload…</Text>
          </View>
        )}

        {/* ── Photo cache error ────────────────────────────────────────────── */}
        {photoBlobRef.current === "error" && photoUri && (
          <View style={s.warnBanner}>
            <Text style={s.warnBannerText}>
              ⚠  Could not read licence photo. Please retake the scan.
            </Text>
          </View>
        )}

        {/* ── BAC result ───────────────────────────────────────────────────── */}
        {bacResult && (
          <View style={s.bacSection}>
            <Text style={s.sectionLabel}>LATEST READING</Text>
            <View style={s.bacRow}>
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
                <View style={s.fineContainer}>
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
              <Text style={s.fineDescription}>
                Category: {fineInfo.description}
              </Text>
            )}
          </View>
        )}

        {/* ── Upload button ─────────────────────────────────────────────────── */}
        <View style={s.btnRow}>
          <TouchableOpacity
            style={[s.uploadBtn, uploadButtonDisabled && s.uploadBtnOff]}
            onPress={handleUpload}
            disabled={uploadButtonDisabled}
            activeOpacity={0.85}
          >
            {isUploading ? (
              <View style={s.uploadingRow}>
                <ActivityIndicator color="#1DB954" size="small" />
                <Text style={[s.uploadBtnText, s.uploadBtnTextActive]}>
                  Uploading…
                </Text>
              </View>
            ) : isBlobLoading ? (
              <View style={s.uploadingRow}>
                <ActivityIndicator color="#555" size="small" />
                <Text style={[s.uploadBtnText, s.uploadBtnTextOff]}>
                  Preparing…
                </Text>
              </View>
            ) : (
              <Text
                style={[
                  s.uploadBtnText,
                  uploadButtonDisabled
                    ? s.uploadBtnTextOff
                    : s.uploadBtnTextActive,
                ]}
              >
                Upload Record
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {!driverValid && !isBlobLoading && (
          <Text style={s.uploadHint}>
            Scan driver licence to enable upload
          </Text>
        )}

        {driverValid && !bacResult && (
          <Text style={s.uploadHint}>
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
    flex:            1,
    backgroundColor: "#121212",
  },

  // ── Top bar ─────────────────────────────────────────────────────────────────
  topBar: {
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "space-between",
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  logoWrap: {
    width:        36,
    height:       36,
    borderRadius: 18,
    overflow:     "hidden",
    borderWidth:  1.5,
    borderColor:  "#1DB954",
  },
  logo: {
    width:      "100%",
    height:     "100%",
    resizeMode: "cover",
  },
  island: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              8,
    backgroundColor:  "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical:   8,
    borderRadius:     30,
    borderWidth:      1,
    borderColor:      "rgba(255,255,255,0.07)",
    elevation:        6,
  },
  islandName: {
    color:       "#1DB954",
    fontSize:    13,
    fontWeight:  "800",
    letterSpacing: 1,
  },
  islandDivider: {
    width:           1,
    height:          14,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  islandClock: {
    alignItems: "flex-start",
  },
  islandTime: {
    color:        "#fff",
    fontSize:     13,
    fontWeight:   "700",
    fontVariant:  ["tabular-nums"],
    letterSpacing: 0.5,
  },
  islandDate: {
    color:     "#555",
    fontSize:  9,
    fontWeight: "500",
  },
  statusPill: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            4,
    width:          64,
    justifyContent: "flex-end",
  },
  statusDot: {
    width:        7,
    height:       7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize:   10,
    fontWeight: "700",
  },

  // ── Scroll ──────────────────────────────────────────────────────────────────
  scroll: {
    flex: 1,
  },
  content: {
    padding:       12,
    paddingBottom: 40,
  },

  // ── Photo loading / error ────────────────────────────────────────────────────
  blobLoadingRow: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom:   4,
  },
  blobLoadingText: {
    color:    "#555",
    fontSize: 11,
  },
  warnBanner: {
    backgroundColor:  "rgba(255,76,76,0.07)",
    borderLeftWidth:  2,
    borderLeftColor:  "#FF4C4C",
    borderRadius:     4,
    padding:          10,
    marginBottom:     8,
  },
  warnBannerText: {
    color:    "#FF4C4C",
    fontSize: 11,
  },

  // ── BAC result ──────────────────────────────────────────────────────────────
  bacSection: {
    marginTop:    16,
    marginBottom: 8,
  },
  sectionLabel: {
    color:        "#444",
    fontSize:     10,
    fontWeight:   "700",
    letterSpacing: 1.5,
    marginBottom: 8,
    marginLeft:   4,
  },
  bacRow: {
    flexDirection:    "row",
    alignItems:       "center",
    backgroundColor:  "#1a1a1a",
    paddingVertical:  12,
    paddingHorizontal: 12,
    borderRadius:     12,
    borderWidth:      1,
    borderColor:      "rgba(255,255,255,0.05)",
  },
  bacDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
    marginRight:  10,
  },
  bacValue: {
    width:        50,
    fontSize:     16,
    fontWeight:   "800",
    letterSpacing: 0.5,
  },
  bacTime: {
    color:       "#666",
    fontSize:    12,
    fontWeight:  "500",
    marginRight: 8,
    fontVariant: ["tabular-nums"],
  },
  fineContainer: {
    marginRight: 8,
    alignItems:  "flex-start",
  },
  fineLabel: {
    color:     "#888",
    fontSize:  9,
    fontWeight: "600",
  },
  fineValue: {
    fontSize:  14,
    fontWeight: "800",
  },
  bacStatus: {
    fontSize:     11,
    fontWeight:   "800",
    letterSpacing: 0.5,
    width:        70,
    textAlign:    "right",
  },
  fineDescription: {
    color:      "#FFA500",
    fontSize:   10,
    marginTop:  4,
    marginLeft: 22,
    fontStyle:  "italic",
  },

  // ── Upload ──────────────────────────────────────────────────────────────────
  btnRow: {
    flexDirection: "row",
    gap:           12,
    marginBottom:  8,
    marginTop:     10,
  },
  uploadBtn: {
    flex:            1,
    paddingVertical: 16,
    borderRadius:    14,
    alignItems:      "center",
    justifyContent:  "center",
    borderWidth:     1.5,
    borderColor:     "#1DB954",
  },
  uploadBtnOff: {
    borderColor: "#2a2a2a",
  },
  uploadingRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
  },
  uploadBtnText: {
    fontSize:   15,
    fontWeight: "700",
  },
  uploadBtnTextActive: {
    color: "#1DB954",
  },
  uploadBtnTextOff: {
    color: "#333",
  },
  uploadHint: {
    color:     "#444",
    fontSize:  10,
    textAlign: "center",
    marginTop: 4,
  },
  legalNote: {
    color:     "#2a2a2a",
    fontSize:  9,
    textAlign: "center",
    marginTop: 12,
  },
});