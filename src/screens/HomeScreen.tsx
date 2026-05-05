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
  TextInput,
  StyleSheet,
  StatusBar,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { launchImageLibrary } from "react-native-image-picker";
import { BACKEND_URL } from "@env";
import { useOfficer } from "../context/OfficerContext";
import { useNetworkStatus } from "../helpers/network";
import { useLiveClock } from "../hooks/useLiveClock";
import { type DriverData, FIELD_LIMITS } from "../helpers/constants";
import { useBreathalyser } from "../context/BreathalyserContext";
import { calculateFine } from "../helpers/fineCalculator";
import { getToken } from "../security/secureStorage";

// ── Upload error messages ──────────────────────────────

const UploadErrors = {
  missingDriver: () =>
    "Please fill in all driver licence details before uploading.",
  missingBac: () =>
    "A breathalyser reading is required before uploading a record.",
  photoNotReady: () =>
    "The licence photo is still loading. Wait a moment and try again.",
  noPhoto: () =>
    "Attach a photo of the driver licence before uploading.",
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

// ── Read photo into Blob (Android content:// safe) ───

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

// ── Component ──────────────────────────────────────────

export default function HomeScreen() {
  const { officer } = useOfficer();
  const { isConnected } = useNetworkStatus();
  const { date, time } = useLiveClock();
  const { result: bacResult } = useBreathalyser();

  // ── Driver fields state ──────────────────────────────
  const [surname, setSurname] = useState("");
  const [firstName, setFirstName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [licenceCode, setLicenceCode] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  // ── Photo state ─────────────────────────────────────
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isBlobLoading, setIsBlobLoading] = useState(false);
  const photoBlobRef = useRef<Blob | "error" | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { uploadAbortRef.current?.abort(); };
  }, []);

  // ── Pre-cache photo blob after pick ────────────────
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

  // ── Pick photo from gallery ────────────────────────
  const handlePickPhoto = useCallback(async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: "photo",
        quality: 0.85,
        includeBase64: false,
      });

      if (result.didCancel) return;
      if (!result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      if (!asset?.uri) return;

      let uri = asset.uri;
      if (
        Platform.OS === "android" &&
        !uri.startsWith("file://") &&
        !uri.startsWith("content://")
      ) {
        uri = `file://${uri}`;
      }

      setPhotoUri(uri);
      precachePhotoBlob(uri);
    } catch (err: any) {
      Alert.alert("Error", "Could not access photo library.");
    }
  }, [precachePhotoBlob]);

  // ── Check all required fields filled ───────────────
  const driverValid =
    surname.trim() !== "" &&
    firstName.trim() !== "" &&
    dateOfBirth.trim() !== "" &&
    gender.trim() !== "" &&
    idNumber.trim() !== "" &&
    licenceNumber.trim() !== "" &&
    licenceCode.trim() !== "" &&
    issueDate.trim() !== "" &&
    expiryDate.trim() !== "";

  // ── Build DriverData object ────────────────────────
  const buildDriverData = useCallback((): DriverData => ({
    surname,
    firstName,
    dateOfBirth,
    gender: gender.toUpperCase(),
    idNumber,
    licenceNumber,
    licenceCode,
    issueDate,
    expiryDate,
  }), [surname, firstName, dateOfBirth, gender, idNumber, licenceNumber, licenceCode, issueDate, expiryDate]);

  // ── Upload readiness – NO longer requires BAC to enable button ──
  const uploadReady =
    driverValid &&
    !!photoUri &&
    !isBlobLoading &&
    photoBlobRef.current instanceof Blob;

  const uploadButtonDisabled = !uploadReady || isUploading;

  // ── Upload logic ───────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!driverValid) {
      Alert.alert("Incomplete Details", UploadErrors.missingDriver());
      return;
    }
    if (!bacResult) {
      Alert.alert("BAC Reading Required", UploadErrors.missingBac());
      return;
    }
    if (!photoUri) {
      Alert.alert("Photo Missing", UploadErrors.noPhoto());
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

      const driverData = buildDriverData();

      const formData = new FormData();
      formData.append("driverData", JSON.stringify(driverData));
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
    bacResult,
    photoUri,
    isBlobLoading,
    isConnected,
    officer,
    buildDriverData,
  ]);

  // ── Derived ──────────────────────────────────────────
  const fineInfo = bacResult
    ? calculateFine(parseFloat(bacResult.bacPercent.replace("%", "")))
    : null;

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
        {/* ── Manual Driver Licence Form ── */}
        <View style={s.formCard}>
          <Text style={s.formTitle}>Driver Licence Details</Text>

          <Text style={s.label}>Surname</Text>
          <TextInput
            style={s.input}
            value={surname}
            onChangeText={setSurname}
            maxLength={FIELD_LIMITS.surname}
            placeholder="Enter surname"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>First Name</Text>
          <TextInput
            style={s.input}
            value={firstName}
            onChangeText={setFirstName}
            maxLength={FIELD_LIMITS.firstName}
            placeholder="Enter first name"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>Date of Birth (DD/MM/YYYY)</Text>
          <TextInput
            style={s.input}
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            maxLength={10}
            placeholder="DD/MM/YYYY"
            placeholderTextColor="#555"
            keyboardType="numbers-and-punctuation"
          />

          <Text style={s.label}>Gender (M / F)</Text>
          <TextInput
            style={s.input}
            value={gender}
            onChangeText={(t) => setGender(t.toUpperCase())}
            maxLength={1}
            placeholder="M or F"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>ID Number</Text>
          <TextInput
            style={s.input}
            value={idNumber}
            onChangeText={setIdNumber}
            maxLength={FIELD_LIMITS.idNumber}
            placeholder="e.g. 63-1234567A12"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>Licence Number</Text>
          <TextInput
            style={s.input}
            value={licenceNumber}
            onChangeText={setLicenceNumber}
            maxLength={FIELD_LIMITS.licenceNumber}
            placeholder="Enter licence number"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>Licence Code (e.g. B, CE, 4)</Text>
          <TextInput
            style={s.input}
            value={licenceCode}
            onChangeText={setLicenceCode}
            maxLength={4}
            placeholder="Code"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>Issue Date (DD/MM/YYYY)</Text>
          <TextInput
            style={s.input}
            value={issueDate}
            onChangeText={setIssueDate}
            maxLength={10}
            placeholder="DD/MM/YYYY"
            placeholderTextColor="#555"
            keyboardType="numbers-and-punctuation"
          />

          <Text style={s.label}>Expiry Date (DD/MM/YYYY)</Text>
          <TextInput
            style={s.input}
            value={expiryDate}
            onChangeText={setExpiryDate}
            maxLength={10}
            placeholder="DD/MM/YYYY"
            placeholderTextColor="#555"
            keyboardType="numbers-and-punctuation"
          />

          {/* Photo picker */}
          <TouchableOpacity style={s.photoBtn} onPress={handlePickPhoto}>
            <Text style={s.photoBtnText}>
              {photoUri ? "📷  Change Licence Photo" : "📷  Attach Licence Photo"}
            </Text>
          </TouchableOpacity>

          {photoUri && (
            <View style={s.previewContainer}>
              <Image
                source={{ uri: photoUri }}
                style={s.previewImage}
                resizeMode="contain"
              />
              <Text style={s.previewHint}>Licence photo attached</Text>
            </View>
          )}

          {isBlobLoading && (
            <View style={s.blobRow}>
              <ActivityIndicator size="small" color="#1DB954" />
              <Text style={s.blobText}>Preparing photo for upload…</Text>
            </View>
          )}
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

        {/* Upload button – enabled without BAC, alert shown if missing */}
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

        {/* Hints */}
        {!driverValid && (
          <Text style={s.hint}>
            Complete all driver details and attach a licence photo
          </Text>
        )}
        {driverValid && !photoUri && (
          <Text style={s.hint}>Attach the licence photo before uploading</Text>
        )}
        {driverValid && !!photoUri && !bacResult && (
          <Text style={s.hint}>
            Capture a BAC reading – required to complete upload
          </Text>
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

  // Form card
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
  photoBtn: {
    backgroundColor: "#1DB954",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  photoBtnText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "700",
  },
  previewContainer: {
    marginTop: 12,
    alignItems: "center",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  previewImage: {
    width: "100%",
    aspectRatio: 1.58,
  },
  previewHint: {
    color: "#555",
    fontSize: 9,
    marginTop: 6,
    marginBottom: 8,
    textAlign: "center",
  },

  // blob loading
  blobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  blobText: {
    color: "#555",
    fontSize: 11,
  },

  // BAC section
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