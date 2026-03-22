import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator,
} from "react-native";
import { usePermissions }  from "../../hooks/usePermissions";
import { type DriverData } from "../../helpers/constants";

interface Props {
  onDataChange: (data: DriverData, isValid: boolean, photoUri: string | null) => void;
}

const EMPTY: DriverData = {
  surname:       "",
  firstName:     "",
  dateOfBirth:   "",
  gender:        "",
  idNumber:      "",
  licenceNumber: "",
  licenceCode:   "",
  issueDate:     "",
  expiryDate:    "",
};

export default function DriverCard({ onDataChange }: Props) {
  const { requestCamera } = usePermissions();

  const [data,     setData]     = useState<DriverData>(EMPTY);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error,    setError]    = useState("");

  const hasData = !!(data.surname || data.licenceNumber);

  const handleScan = useCallback(async () => {
    setError("");
    const granted = await requestCamera();
    if (!granted) { setError("Camera permission denied"); return; }
    setScanning(true);

    try {
      const { launchCamera } = await import("react-native-image-picker");
      const res = await launchCamera({
        mediaType:     "photo",
        quality:       0.85,
        saveToPhotos:  false,
        includeBase64: false,
      });

      if (res.didCancel || !res.assets?.[0]) {
        setScanning(false);
        return;
      }

      const uri = res.assets[0].uri ?? "";
      setPhotoUri(uri);

      const { parseDriverLicence } = await import("../../helpers/ocrParser");
      const parsed = await parseDriverLicence(uri);
      setData(parsed);

      const valid = !!(parsed.surname && parsed.licenceNumber);
      onDataChange(parsed, valid, uri);
    } catch (err: any) {
      setError("Could not read licence — try again");
    }

    setScanning(false);
  }, [requestCamera, onDataChange]);

  const handleClear = useCallback(() => {
    setData(EMPTY);
    setPhotoUri(null);
    setError("");
    onDataChange(EMPTY, false, null);
  }, [onDataChange]);

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.title}>Driver Licence</Text>
        {hasData && (
          <TouchableOpacity onPress={handleClear} style={s.clearBtn}>
            <Text style={s.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Photo box — tap to scan, stays visible after scan */}
      <TouchableOpacity
        style={[s.photoBox, photoUri && s.photoBoxFilled]}
        onPress={handleScan}
        disabled={scanning}
        activeOpacity={0.8}
      >
        {scanning ? (
          <View style={s.scanningWrap}>
            <ActivityIndicator color="#1DB954" size="large" />
            <Text style={s.scanningText}>Reading licence…</Text>
          </View>
        ) : photoUri ? (
          <>
            <Image source={{ uri: photoUri }} style={s.photo} resizeMode="cover" />
            <View style={s.retapHint}>
              <Text style={s.retapText}>Tap to re-scan</Text>
            </View>
          </>
        ) : (
          <View style={s.placeholder}>
            <Text style={s.placeholderIcon}>📷</Text>
            <Text style={s.placeholderText}>Tap to scan driver licence</Text>
            <Text style={s.placeholderSub}>Camera opens automatically</Text>
          </View>
        )}
      </TouchableOpacity>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {hasData && (
        <View style={s.fields}>
          {data.surname       ? <Row label="Surname"    value={data.surname} />       : null}
          {data.firstName     ? <Row label="First Name" value={data.firstName} />     : null}
          {data.idNumber      ? <Row label="ID Number"  value={data.idNumber} />      : null}
          {data.licenceNumber ? <Row label="Licence No" value={data.licenceNumber} /> : null}
          {data.licenceCode   ? <Row label="Code"       value={data.licenceCode} />   : null}
          {data.expiryDate    ? <Row label="Expires"    value={data.expiryDate} />    : null}
        </View>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card:         { backgroundColor: "#1a1a1a", borderRadius: 12, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  header:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  title:        { color: "#1DB954", fontSize: 12, fontWeight: "700" },
  clearBtn:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#111" },
  clearBtnText: { color: "#555", fontSize: 11 },
  photoBox:     { marginHorizontal: 14, marginBottom: 12, height: 160, borderRadius: 10, overflow: "hidden", backgroundColor: "#111", borderWidth: 1, borderColor: "#222", borderStyle: "dashed", justifyContent: "center", alignItems: "center" },
  photoBoxFilled: { borderStyle: "solid", borderColor: "rgba(29,185,84,0.3)" },
  photo:        { width: "100%", height: "100%" },
  retapHint:    { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingVertical: 5, alignItems: "center" },
  retapText:    { color: "#aaa", fontSize: 10 },
  scanningWrap: { alignItems: "center", gap: 10 },
  scanningText: { color: "#1DB954", fontSize: 12 },
  placeholder:       { alignItems: "center", gap: 6 },
  placeholderIcon:   { fontSize: 28 },
  placeholderText:   { color: "#555", fontSize: 13, fontWeight: "600" },
  placeholderSub:    { color: "#333", fontSize: 10 },
  errorBox:     { marginHorizontal: 14, marginBottom: 8, backgroundColor: "rgba(255,76,76,0.08)", borderLeftWidth: 2, borderLeftColor: "#FF4C4C", borderRadius: 6, padding: 8 },
  errorText:    { color: "#FF4C4C", fontSize: 11 },
  fields:       { paddingHorizontal: 14, paddingBottom: 12 },
  row:          { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#111" },
  rowLabel:     { color: "#555", fontSize: 11 },
  rowValue:     { color: "#fff", fontSize: 11, fontWeight: "600", flexShrink: 1, textAlign: "right", maxWidth: "65%" },
});