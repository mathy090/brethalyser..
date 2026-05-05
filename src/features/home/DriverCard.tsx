// src/features/home/DriverCard.tsx
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import TextRecognition from "@react-native-ml-kit/text-recognition";

import { parseOCRText } from "../../helpers/ocrParser";
import { postProcess } from "../../helpers/ocrPostProcessor";
import { type DriverData, FIELD_LIMITS } from "../../helpers/constants";
import DataRow from "./DataRow";

interface DriverCardProps {
  onDataChange: (
    data: DriverData,
    isValid: boolean,
    photoUri: string | null
  ) => void;
}

const EMPTY_DRIVER: DriverData = {
  surname: "",
  firstName: "",
  dateOfBirth: "",
  gender: "",
  idNumber: "",
  licenceNumber: "",
  licenceCode: "",
  issueDate: "",
  expiryDate: "",
};

export default function DriverCard({ onDataChange }: DriverCardProps) {
  const [data, setData] = useState<DriverData>(EMPTY_DRIVER);
  const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const handleChange = useCallback(
    (key: keyof DriverData, val: string) => {
      setData((prev) => ({ ...prev, [key]: val }));
    },
    []
  );

  const handlePickImage = useCallback(async () => {
    setPhase("processing");

    try {
      const result = await launchImageLibrary({
        mediaType: "photo",
        quality: 0.85,
        includeBase64: false,
      });

      // user cancelled
      if (result.didCancel) {
        setPhase("idle");
        return;
      }

      // no assets returned
      if (!result.assets || result.assets.length === 0) {
        setPhase("idle");
        return;
      }

      const asset = result.assets[0];

      // asset itself undefined
      if (!asset) {
        setPhase("idle");
        return;
      }

      // uri missing
      if (!asset.uri) {
        Alert.alert("Error", "Could not get image path. Try again.");
        setPhase("idle");
        return;
      }

      let uri = asset.uri;

      // android URI fix
      if (
        Platform.OS === "android" &&
        !uri.startsWith("file://") &&
        !uri.startsWith("content://")
      ) {
        uri = `file://${uri}`;
      }

      setPhotoUri(uri);

      // run OCR
      const textResult = await TextRecognition.recognize(uri);
      const rawText = textResult?.text ?? "";

      const parsed = parseOCRText(rawText);
      const cleaned = postProcess(parsed.data ?? {});

      setData(cleaned);
      setPhase("done");

      onDataChange(cleaned, true, uri);
    } catch (err: any) {
      console.error("DriverCard error:", err?.message ?? err);
      Alert.alert(
        "Processing Failed",
        "Could not read this image. Try a clearer photo."
      );
      setPhase("idle");
    }
  }, [onDataChange]);

  const handleRetake = useCallback(() => {
    setData(EMPTY_DRIVER);
    setPhotoUri(null);
    setPhase("idle");
    onDataChange(EMPTY_DRIVER, false, null);
  }, [onDataChange]);

  return (
    <View style={styles.card}>
      {phase === "done" && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            AI can make mistakes. Double check details before upload.
          </Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.title}>Driver Licence</Text>
        {phase === "done" && (
          <TouchableOpacity onPress={handleRetake}>
            <Text style={styles.retakeText}>🔄 Rescan</Text>
          </TouchableOpacity>
        )}
      </View>

      {phase === "idle" && (
        <TouchableOpacity onPress={handlePickImage} style={styles.pickBtn}>
          <Text style={styles.pickBtnText}>📷  Choose from Gallery</Text>
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
          <DataRow
            label="Surname"
            value={data.surname}
            editable
            onChange={(val) => handleChange("surname", val)}
            maxLength={FIELD_LIMITS.surname}
          />
          <DataRow
            label="First Name"
            value={data.firstName}
            editable
            onChange={(val) => handleChange("firstName", val)}
            maxLength={FIELD_LIMITS.firstName}
          />
          <DataRow
            label="DOB"
            value={data.dateOfBirth}
            placeholder="DD/MM/YYYY"
            editable
            onChange={(val) => handleChange("dateOfBirth", val)}
            maxLength={10}
          />
          <DataRow
            label="Gender"
            value={data.gender}
            placeholder="M / F"
            editable
            onChange={(val) => handleChange("gender", val.toUpperCase())}
            maxLength={1}
          />
          <DataRow
            label="ID Number"
            value={data.idNumber}
            editable
            onChange={(val) => handleChange("idNumber", val)}
            maxLength={FIELD_LIMITS.idNumber}
          />
          <DataRow
            label="Licence No"
            value={data.licenceNumber}
            editable
            onChange={(val) => handleChange("licenceNumber", val)}
            maxLength={FIELD_LIMITS.licenceNumber}
          />
          <DataRow
            label="Code"
            value={data.licenceCode}
            placeholder="B / CE / 4"
            editable
            onChange={(val) => handleChange("licenceCode", val)}
            maxLength={4}
          />
          <DataRow
            label="Issue Date"
            value={data.issueDate}
            placeholder="DD/MM/YYYY"
            editable
            onChange={(val) => handleChange("issueDate", val)}
            maxLength={10}
          />
          <DataRow
            label="Expiry Date"
            value={data.expiryDate}
            placeholder="DD/MM/YYYY"
            editable
            onChange={(val) => handleChange("expiryDate", val)}
            maxLength={10}
          />

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
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  retakeText: {
    color: "#1DB954",
    fontSize: 12,
    fontWeight: "600",
  },
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
    justifyContent: "center",
  },
  pickBtnText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "700",
  },
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 20,
    justifyContent: "center",
  },
  processingText: {
    color: "#888",
    fontSize: 12,
  },
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