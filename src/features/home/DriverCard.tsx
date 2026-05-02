/**
 * src/features/home/DriverCard.tsx
 * Driver licence scanning with OCR, manual editing, and debounced validation
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Modal, Alert,
  TextInput,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";
import {
  parseDriverLicence,
  FIELD_LIMITS,
  isValidZimID,
  isValidDate,
  isValidLicenceNumber,
} from "../../helpers/ocrParser";
import { type DriverData, EMPTY_DRIVER } from "../../helpers/constants";

interface Props {
  onDataChange: (data: DriverData, isValid: boolean, photoUri: string | null) => void;
}

const FIELD_CONFIGS: {
  key:         keyof DriverData;
  label:       string;
  num:         string;
  caps:        "none" | "words" | "characters";
  placeholder: string;
}[] = [
  { key: "surname",       label: "Surname",  num: "1",    caps: "words",      placeholder: "Runowanda"        },
  { key: "firstName",     label: "Name",     num: "2",    caps: "words",      placeholder: "Mathews Tafadzwa" },
  { key: "dateOfBirth",   label: "DOB",      num: "3",    caps: "none",       placeholder: "21/04/2006"       },
  { key: "gender",        label: "Gender",   num: "3",    caps: "characters", placeholder: "M"                },
  { key: "idNumber",      label: "ID No",    num: "4d",   caps: "characters", placeholder: "01/232006083Z04"  },
  { key: "licenceNumber", label: "Lic No",   num: "5",    caps: "characters", placeholder: "AA00625325"       },
  { key: "licenceCode",   label: "Code",     num: "9",    caps: "characters", placeholder: "BE"               },
  { key: "issueDate",     label: "Issue",    num: "4a,b", caps: "none",       placeholder: "09/01/2025"       },
  { key: "expiryDate",    label: "Expiry",   num: "11",   caps: "none",       placeholder: "09/01/2030"       },
];

const VALIDATORS: Partial<Record<keyof DriverData, (v: string) => boolean>> = {
  dateOfBirth:   isValidDate,
  issueDate:     isValidDate,
  expiryDate:    isValidDate,
  idNumber:      isValidZimID,
  licenceNumber: isValidLicenceNumber,
  gender:        v => v === "M" || v === "F",
};

// ── Camera Modal ──────────────────────────────────────────────────────────────

function CameraModal({ visible, onCapture, onClose }: {
  visible: boolean;
  onCapture: (uri: string) => void;
  onClose: () => void;
}) {
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const [busy, setBusy] = useState(false);

  const shoot = useCallback(async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePhoto({ flash: "off" });
      onCapture(`file://${photo.path}`);
    } catch {
      Alert.alert("Error", "Could not capture photo. Try again.");
    }
    setBusy(false);
  }, [busy, onCapture]);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={cm.root}>
        {device ? (
          <Camera
            ref={camera}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible}
            photo
          />
        ) : (
          <View style={cm.noDevice}>
            <Text style={cm.noDeviceTxt}>No camera available</Text>
          </View>
        )}
        <View style={cm.top}>
          <TouchableOpacity onPress={onClose} style={cm.closeBtn}>
            <Text style={cm.closeTxt}>✕  CLOSE</Text>
          </TouchableOpacity>
          <Text style={cm.title}>SCAN LICENCE</Text>
          <View style={{ width: 72 }} />
        </View>
        <View style={cm.vfWrap}>
          <View style={cm.vf}>
            <View style={[cm.corner, cm.cTL]} />
            <View style={[cm.corner, cm.cTR]} />
            <View style={[cm.corner, cm.cBL]} />
            <View style={[cm.corner, cm.cBR]} />
            <View style={cm.scanLine} />
          </View>
          <Text style={cm.hint}>Align full licence front face within frame</Text>
        </View>
        <View style={cm.bottom}>
          <TouchableOpacity
            style={cm.captureBtn}
            onPress={shoot}
            disabled={busy || !device}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator color="#121212" size="small" />
              : <View style={cm.captureBtnCore} />
            }
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Zoom Modal ────────────────────────────────────────────────────────────────

function ZoomModal({ uri, visible, onClose }: {
  uri: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent transparent>
      <View style={zm.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        {uri && (
          <View style={zm.imgWrap}>
            <Image source={{ uri }} style={zm.img} resizeMode="contain" />
            <TouchableOpacity style={zm.closeBtn} onPress={onClose}>
              <Text style={zm.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Fields block — with DEBOUNCED VALIDATION ─────────────────────────────────

function FieldsBlock({ data, onChange, retaking, visible }: {
  data: DriverData;
  onChange: (key: keyof DriverData, val: string) => void;
  retaking: boolean;
  visible: boolean;
}) {
  const [focused, setFocused] = useState<keyof DriverData | null>(null);

  // 🔧 Debounced validation hook - prevents error flickering during editing
  function useDebouncedValidator(
    value: string,
    validator: ((v: string) => boolean) | undefined,
    delay = 500
  ) {
    const [isValid, setIsValid] = useState(true);
    
    useEffect(() => {
      if (!validator) {
        setIsValid(true);
        return;
      }
      
      const timer = setTimeout(() => {
        setIsValid(!value || validator(value));
      }, delay);
      
      return () => clearTimeout(timer);
    }, [value, validator, delay]);
    
    return isValid;
  }

  return (
    <View style={[fb.wrap, !visible && fb.hidden]}>
      {retaking && (
        <View style={fb.retakingOverlay}>
          <ActivityIndicator color="#1DB954" size="small" />
          <Text style={fb.retakingTxt}>Reading new scan…</Text>
        </View>
      )}
      {FIELD_CONFIGS.map((fc, i) => {
        const val    = data[fc.key];
        const filled = val.length > 0;
        const validator = VALIDATORS[fc.key];
        
        // 🔧 Use debounced validation instead of immediate
        const isValid = useDebouncedValidator(val, validator);
        
        const isFoc  = focused === fc.key;
        const isLast = i === FIELD_CONFIGS.length - 1;

        return (
          <View
            key={fc.key}
            style={[
              fb.row,
              isFoc  && fb.rowFocused,
              !isValid && filled && fb.rowError, // ← Uses debounced isValid
              isLast && { borderBottomWidth: 0 },
            ]}
          >
            <Text style={fb.num}>{fc.num}</Text>
            <Text style={fb.label}>{fc.label}</Text>
            <TextInput
              style={fb.input}
              value={val}
              onChangeText={v => {
                if (v.length <= FIELD_LIMITS[fc.key]) onChange(fc.key, v);
              }}
              placeholder={fc.placeholder}
              placeholderTextColor="#252525"
              maxLength={FIELD_LIMITS[fc.key]}
              selectionColor="#1DB954"
              autoCapitalize={fc.caps}
              editable={!retaking}
              onFocus={() => setFocused(fc.key)}
              onBlur={() => setFocused(null)}
            />
            {/* 🔧 Show error dot only when debounced validation fails AND not focused */}
            {!isValid && filled && !isFoc && <View style={fb.errorDot} />}
          </View>
        );
      })}
    </View>
  );
}

// ── DriverCard ────────────────────────────────────────────────────────────────

export default function DriverCard({ onDataChange }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();

  const [data,       setData]       = useState<DriverData>(EMPTY_DRIVER);
  const [photoUri,   setPhotoUri]   = useState<string | null>(null);
  const [phase,      setPhase]      = useState<"idle" | "scanning" | "done" | "retaking">("idle");
  const [showCamera, setShowCamera] = useState(false);
  const [showZoom,   setShowZoom]   = useState(false);
  const [error,      setError]      = useState("");

  const prevData     = useRef<DriverData>(EMPTY_DRIVER);
  const prevPhotoUri = useRef<string | null>(null);

  const openCamera = useCallback(async () => {
    setError("");
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        setError("Camera permission denied. Enable it in Settings.");
        return;
      }
    }
    setShowCamera(true);
  }, [hasPermission, requestPermission]);

  const handleCapture = useCallback(async (uri: string) => {
    setShowCamera(false);

    const isRetake = phase === "done" || phase === "retaking";

    if (isRetake) {
      prevData.current     = data;
      prevPhotoUri.current = photoUri;
      setPhase("retaking");
    } else {
      setPhase("scanning");
    }

    setPhotoUri(uri);
    setError("");

    try {
      const parsed = await parseDriverLicence(uri);
      setData(parsed);
      setPhase("done");
      onDataChange(parsed, !!(parsed.surname && parsed.licenceNumber), uri);
    } catch {
      if (isRetake) {
        setData(prevData.current);
        setPhotoUri(prevPhotoUri.current);
        setPhase("done");
        onDataChange(
          prevData.current,
          !!(prevData.current.surname && prevData.current.licenceNumber),
          prevPhotoUri.current
        );
        setError("Could not read new scan. Previous data restored.");
      } else {
        setData(EMPTY_DRIVER);
        setPhase("done");
        onDataChange(EMPTY_DRIVER, false, uri);
        setError("Could not read licence. Fill in details manually.");
      }
    }
  }, [phase, data, photoUri, onDataChange]);

  const handleFieldChange = useCallback((key: keyof DriverData, val: string) => {
    setData(prev => {
      const next = { ...prev, [key]: val };
      onDataChange(next, !!(next.surname && next.licenceNumber), photoUri);
      return next;
    });
  }, [onDataChange, photoUri]);

  const handleRetake = useCallback(() => openCamera(), [openCamera]);

  const handleClear = useCallback(() => {
    setData(EMPTY_DRIVER);
    setPhotoUri(null);
    setError("");
    setPhase("idle");
    prevData.current     = EMPTY_DRIVER;
    prevPhotoUri.current = null;
    onDataChange(EMPTY_DRIVER, false, null);
  }, [onDataChange]);

  const isRetaking     = phase === "retaking";
  const showDoneHeader = phase === "done" || phase === "retaking";
  const showFields     = phase === "done" || phase === "retaking";
  const showIdle       = phase === "idle";
  const showScanning   = phase === "scanning";

  return (
    <>
      <CameraModal
        visible={showCamera}
        onCapture={handleCapture}
        onClose={() => setShowCamera(false)}
      />
      <ZoomModal
        uri={photoUri}
        visible={showZoom}
        onClose={() => setShowZoom(false)}
      />

      <View style={s.card}>

        {/* Idle */}
        <View style={[s.idle, !showIdle && s.hidden]}>
          <TouchableOpacity
            style={s.idleInner}
            onPress={openCamera}
            activeOpacity={0.75}
            disabled={!showIdle}
          >
            <Text style={s.idleIcon}>🪪</Text>
            <Text style={s.idleTxt}>Tap to scan driver licence</Text>
          </TouchableOpacity>
        </View>

        {/* Scanning */}
        <View style={[s.idle, !showScanning && s.hidden]}>
          <ActivityIndicator color="#1DB954" size="small" />
          <Text style={s.scanningTxt}>Reading licence…</Text>
        </View>

        {/* Done header */}
        <View style={[s.doneHeader, !showDoneHeader && s.hidden]}>
          <View style={s.headerLeft}>
            <View style={s.accent} />
            <Text style={s.headerTitle}>DRIVER DETAILS</Text>
          </View>
          <View style={s.headerRight}>
            {photoUri && (
              <TouchableOpacity
                style={s.thumb}
                onPress={() => setShowZoom(true)}
                activeOpacity={0.8}
                disabled={isRetaking}
              >
                <Image source={{ uri: photoUri }} style={s.thumbImg} resizeMode="cover" />
                <View style={s.thumbOverlay}>
                  <Text style={s.thumbZoomTxt}>⤢</Text>
                </View>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.actionBtn, isRetaking && s.btnDisabled]}
              onPress={handleRetake}
              disabled={isRetaking}
              activeOpacity={0.7}
            >
              <Text style={s.actionBtnTxt}>RETAKE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtnGhost, isRetaking && s.btnDisabled]}
              onPress={handleClear}
              disabled={isRetaking}
              activeOpacity={0.7}
            >
              <Text style={s.actionBtnGhostTxt}>CLEAR</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Fields — always mounted, with debounced validation */}
        <FieldsBlock
          data={data}
          onChange={handleFieldChange}
          retaking={isRetaking}
          visible={showFields}
        />

        {!!error && (
          <View style={s.errorBox}>
            <Text style={s.errorTxt}>{error}</Text>
          </View>
        )}

      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CS = 18;
const CT = 2.5;

const cm = StyleSheet.create({
  root:           { flex: 1, backgroundColor: "#000" },
  noDevice:       { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", backgroundColor: "#000" } as any,
  noDeviceTxt:    { color: "#555", fontSize: 13 },
  top:            { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, backgroundColor: "rgba(0,0,0,0.6)" },
  title:          { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  closeBtn:       { width: 72 },
  closeTxt:       { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  vfWrap:         { flex: 1, justifyContent: "center", alignItems: "center", gap: 18 },
  vf:             { width: 320, height: 200, position: "relative" },
  corner:         { position: "absolute", width: CS, height: CS, borderColor: "#1DB954" },
  cTL:            { top: 0,    left: 0,  borderTopWidth: CT,    borderLeftWidth: CT   },
  cTR:            { top: 0,    right: 0, borderTopWidth: CT,    borderRightWidth: CT  },
  cBL:            { bottom: 0, left: 0,  borderBottomWidth: CT, borderLeftWidth: CT   },
  cBR:            { bottom: 0, right: 0, borderBottomWidth: CT, borderRightWidth: CT  },
  scanLine:       { position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: "#1DB95450" },
  hint:           { color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: "600", letterSpacing: 1 },
  bottom:         { alignItems: "center", paddingBottom: 52, paddingTop: 20, backgroundColor: "rgba(0,0,0,0.6)" },
  captureBtn:     { width: 70, height: 70, borderRadius: 35, borderWidth: 3, borderColor: "rgba(255,255,255,0.6)", justifyContent: "center", alignItems: "center" },
  captureBtnCore: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#1DB954" },
});

const zm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.93)", justifyContent: "center", alignItems: "center" },
  imgWrap:  { width: "92%", aspectRatio: 1.58, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "rgba(29,185,84,0.3)" },
  img:      { width: "100%", height: "100%" },
  closeBtn: { position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#333" },
  closeTxt: { color: "#fff", fontSize: 11, fontWeight: "700" },
});

const fb = StyleSheet.create({
  wrap:            { position: "relative" },
  hidden:          { display: "none" },
  retakingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, backgroundColor: "rgba(18,18,18,0.8)", justifyContent: "center", alignItems: "center", gap: 8 },
  retakingTxt:     { color: "#1DB954", fontSize: 10, fontWeight: "600" },
  row:             { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#111", paddingVertical: 4, paddingHorizontal: 12, gap: 6 },
  rowFocused:      { borderBottomColor: "#1DB95430", backgroundColor: "rgba(29,185,84,0.03)" },
  rowError:        { borderBottomColor: "rgba(255,76,76,0.3)" },
  num:             { color: "#1DB954", fontSize: 7, fontWeight: "800", width: 22 },
  label:           { color: "#333", fontSize: 9, fontWeight: "600", width: 44 },
  input:           { flex: 1, color: "#e0e0e0", fontSize: 10, fontWeight: "600", paddingVertical: 0, textAlign: "right" },
  errorDot:        { width: 5, height: 5, borderRadius: 3, backgroundColor: "#FF4C4C", marginLeft: 4 },
});

const s = StyleSheet.create({
  card:             { backgroundColor: "#1a1a1a", borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  hidden:           { display: "none" },

  idle:             { height: 64, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10 },
  idleInner:        { flexDirection: "row", alignItems: "center", gap: 10 },
  idleIcon:         { fontSize: 18 },
  idleTxt:          { color: "#333", fontSize: 12, fontWeight: "600" },
  scanningTxt:      { color: "#1DB954", fontSize: 11, marginLeft: 8 },

  doneHeader:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 7, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "#1e1e1e" },
  headerLeft:       { flexDirection: "row", alignItems: "center", gap: 8 },
  accent:           { width: 3, height: 11, backgroundColor: "#1DB954", borderRadius: 2 },
  headerTitle:      { color: "#555", fontSize: 8, fontWeight: "800", letterSpacing: 2 },
  headerRight:      { flexDirection: "row", alignItems: "center", gap: 6 },

  thumb:            { width: 36, height: 24, borderRadius: 4, overflow: "hidden", borderWidth: 1, borderColor: "rgba(29,185,84,0.4)" },
  thumbImg:         { width: "100%", height: "100%" },
  thumbOverlay:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center" },
  thumbZoomTxt:     { color: "#1DB954", fontSize: 6, fontWeight: "800" },

  actionBtn:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, backgroundColor: "#1DB954" },
  actionBtnTxt:     { color: "#000", fontSize: 7, fontWeight: "900", letterSpacing: 1 },
  actionBtnGhost:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, borderWidth: 1, borderColor: "#2a2a2a" },
  actionBtnGhostTxt:{ color: "#444", fontSize: 7, fontWeight: "700", letterSpacing: 1 },
  btnDisabled:      { opacity: 0.4 },

  errorBox:         { marginHorizontal: 12, marginBottom: 6, marginTop: 4, backgroundColor: "rgba(255,76,76,0.07)", borderLeftWidth: 2, borderLeftColor: "#FF4C4C", borderRadius: 3, padding: 5 },
  errorTxt:         { color: "#FF4C4C", fontSize: 9 },
});