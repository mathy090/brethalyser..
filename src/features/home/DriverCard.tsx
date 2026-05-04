// src/features/home/DriverCard.tsx
import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Alert, ActivityIndicator, Platform
} from "react-native";
import { launchImageLibraryAsync } from "expo-camera/next";
import TextRecognition from "@react-native-ml-kit/text-recognition";

import { parseOCRText } from "../../helpers/ocrParser";
import { postProcess } from "../../helpers/ocrPostProcessor";
import { type DriverData, FIELD_LIMITS } from "../../helpers/constants";
import DataRow from "./DataRow";

interface DriverCardProps {
  onDataChange: ( DriverData, isValid: boolean, photoUri: string | null) => void;
}

// ─── Native-looking Gallery Icon (Pure StyleSheet, zero deps) ─────────────
const GalleryIcon = () => (
  <View style={iconStyles.container}>
    <View style={iconStyles.frame} />
    <View style={iconStyles.mountain1} />
    <View style={iconStyles.mountain2} />
    <View style={iconStyles.sun} />
  </View>
);

const iconStyles = StyleSheet.create({
  container: { width: 18, height: 18, marginRight: 8 },
  frame: {
    position: "absolute",
    width: 16, height: 16,
    borderWidth: 1.5, borderColor: "#000",
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  mountain1: {
    position: "absolute", bottom: 2, left: 2,
    width: 0, height: 0,
    borderLeftWidth: 4, borderLeftColor: "transparent",
    borderRightWidth: 4, borderRightColor: "transparent",
    borderBottomWidth: 5, borderBottomColor: "#333",
  },
  mountain2: {
    position: "absolute", bottom: 2, left: 6,
    width: 0, height: 0,
    borderLeftWidth: 5, borderLeftColor: "transparent",
    borderRightWidth: 5, borderRightColor: "transparent",
    borderBottomWidth: 6, borderBottomColor: "#555",
  },
  sun: {
    position: "absolute", top: 2.5, right: 2.5,
    width: 3, height: 3,
    borderRadius: 1.5,
    backgroundColor: "#FFA500",
  },
});

export default function DriverCard({ onDataChange }: DriverCardProps) {
  // ─── ALL HOOKS AT TOP (Strict React Rules — No Conditional Hooks) ───────
  const [data, setData] = useState<Partial<DriverData>>({});
  const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [retaking, setRetaking] = useState(false);

  // ─── Handlers (Unconditional — Safe for React) ─────────────────────────
  const handleChange = useCallback((key: keyof DriverData, val: string) => {
    setData(prev => ({ ...prev, [key]: val }));
  }, []);

  const handlePickImage = useCallback(async () => {
    setPhase("processing");
    
    try {
      // ✅ Uses expo-camera's built-in gallery picker (no new deps)
      const result = await launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: false,
        quality: 0.85,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        let uri = result.assets[0].uri;
        
        // Normalize URI for ML Kit on Android
        if (Platform.OS === "android" && !uri.startsWith("file://")) {
          uri = `file://${uri}`;
        }
        
        setPhotoUri(uri);

        // Run OCR on selected image
        const textResult = await TextRecognition.recognize(uri);
        const parsed = parseOCRText(textResult.text);
        const cleaned = postProcess(parsed.data);

        setData(cleaned);
        setPhase("done");
        
        // Pass to HomeScreen (HomeScreen handles final validation/upload)
        onDataChange(cleaned, true, uri);
      } else {
        setPhase("idle");
      }
    } catch (err: any) {
      console.error("Gallery/OCR error:", err);
      Alert.alert("Processing Failed", "Could not extract text from this image.");
      setPhase("idle");
    }
  }, [onDataChange]);

  const handleRetake = useCallback(() => {
    setRetaking(true);
    setData({});
    setPhotoUri(null);
    setPhase("idle");
    setRetaking(false);
  }, []);

  // ─── RENDER (Conditional UI is safe AFTER all hooks) ────────────────────
  return (
    <View style={styles.card}>
      {/* AI Disclaimer Banner — Exact text requested, top of card */}
      {phase === "done" && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            AI can make mistakes. Double check the details before upload.
          </Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.title}>Driver Licence</Text>
        {phase === "done" && (
          <TouchableOpacity onPress={handleRetake} disabled={retaking}>
            <Text style={styles.retakeText}>🔄 Rescan</Text>
          </TouchableOpacity>
        )}
      </View>

      {phase === "idle" && (
        <TouchableOpacity onPress={handlePickImage} style={styles.pickBtn}>
          <GalleryIcon />
          <Text style={styles.pickBtnText}>Choose from Gallery</Text>
        </TouchableOpacity>
      )}

      {phase === "processing" && (
        <View style={styles.processingRow}>
          <ActivityIndicator size="small" color="#1DB954" />
          <Text style={styles.processingText}>Extracting text…</Text>
        </View>
      )}

      {phase === "done" && (
        <View style={styles.fieldsGrid}>
          <DataRow label="Surname" value={data.surname ?? ""} editable={!retaking} onChange={(val) => handleChange("surname", val)} maxLength={FIELD_LIMITS.surname} />
          <DataRow label="First Name" value={data.firstName ?? ""} editable={!retaking} onChange={(val) => handleChange("firstName", val)} maxLength={FIELD_LIMITS.firstName} />
          <DataRow label="DOB" value={data.dateOfBirth ?? ""} placeholder="DD/MM" editable={!retaking} onChange={(val) => handleChange("dateOfBirth", val)} maxLength={10} />
          <DataRow label="Gender" value={data.gender ?? ""} placeholder="M/F" editable={!retaking} onChange={(val) => handleChange("gender", val.toUpperCase())} maxLength={1} />
          <DataRow label="ID Number" value={data.idNumber ?? ""} editable={!retaking} onChange={(val) => handleChange("idNumber", val)} maxLength={FIELD_LIMITS.idNumber} />
          <DataRow label="Licence No" value={data.licenceNumber ?? ""} editable={!retaking} onChange={(val) => handleChange("licenceNumber", val)} maxLength={FIELD_LIMITS.licenceNumber} />
          <DataRow label="Code" value={data.licenceCode ?? ""} placeholder="B/CE/4" editable={!retaking} onChange={(val) => handleChange("licenceCode", val)} maxLength={4} />
          <DataRow label="Issue" value={data.issueDate ?? ""} placeholder="DD/MM" editable={!retaking} onChange={(val) => handleChange("issueDate", val)} maxLength={10} />
          <DataRow label="Expiry" value={data.expiryDate ?? ""} placeholder="DD/MM" editable={!retaking} onChange={(val) => handleChange("expiryDate", val)} maxLength={10} />

          {photoUri && (
            <View style={styles.previewContainer}>
              <View style={styles.previewFrame}>
                <Image 
                  source={{ uri: photoUri }} 
                  style={styles.previewImage} 
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.previewHint}>Original licence photo</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles (Compact, No ScrollView) ──────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  retakeText: { color: "#1DB954", fontSize: 12, fontWeight: "600" },
  
  banner: {
    backgroundColor: "rgba(255,165,0,0.15)",
    borderLeftWidth: 3,
    borderLeftColor: "#FFA500",
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  bannerText: {
    color: "#FFA500",
    fontSize: 11,
    fontWeight: "600",
  },
  
  pickBtn: {
    backgroundColor: "#1DB954",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  pickBtnText: { color: "#000", fontSize: 14, fontWeight: "700" },
  
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 20,
    justifyContent: "center",
  },
  processingText: { color: "#888", fontSize: 12 },
  
  fieldsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  
  previewContainer: {
    marginTop: 12,
    alignItems: "center",
    width: "100%",
  },
  previewFrame: {
    width: "100%",
    aspectRatio: 1.58,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewHint: {
    color: "#555",
    fontSize: 9,
    marginTop: 6,
    textAlign: "center",
  },
});