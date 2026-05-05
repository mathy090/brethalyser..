/**
 * src/screens/HomeScreen.tsx
 *
 * Home screen — Driver management, BAC result display & record upload.
 *
 * Photo handling
 * ──────────────
 * The licence photo is picked via react-native-image-picker. Because React
 * Native's FormData does not always reliably handle `content://` URIs on
 * Android, we read the picked file into a Blob via XMLHttpRequest immediately
 * after OCR completes. The blob is stored in a ref and appended to FormData
 * at upload time — safe regardless of Android's URI scheme.
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

// ─── Photo blob reader ───────────────────────────────────────────────────────
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

  // Driver state
  const [driverValid, setDriverValid] = useState(false);
  const [driverData, setDriverData] = useState<DriverData | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);

  // Photo blob pre‑cache
  const photoBlobRef = useRef<Blob | "error" | null>(null);
  const [isBlobLoading, setIsBlobLoading] = useState(false);

  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
  }, []);

  // ── Photo pre‑caching (triggered by DriverCard) ──────────────────────────
  const precachePhotoBlob = useCallback((uri: string) => {
    photoBlobRef.current = null;
    setIsBlobLoading(true);

    readFileAsBlob(uri)
      .then((blob) => {
        photoBlobRef.current = blob;
        setIsBlobLoading