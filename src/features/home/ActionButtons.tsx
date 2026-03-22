import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";

interface Props {
  driverValid?: boolean;
  onScan?: () => void;
  onUpload?: () => void;
  onPrint?: () => void;
}

export default function ActionButtons({ driverValid = false, onScan, onUpload, onPrint }: Props) {
  const handleUpload = () => {
    if (!driverValid) {
      Alert.alert("Cannot Upload", "Complete and validate all driver fields before uploading.");
      return;
    }
    onUpload?.();
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.btn} onPress={onScan}>
        <Text style={styles.icon}>⬡</Text>
        <Text style={styles.label}>Scan</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, !driverValid && styles.btnLocked]} onPress={handleUpload}>
        <Text style={[styles.icon, !driverValid && styles.lockedText]}>↑</Text>
        <Text style={[styles.label, !driverValid && styles.lockedText]}>Upload</Text>
        {!driverValid && <View style={styles.lockDot} />}
      </TouchableOpacity>

      <TouchableOpacity style={styles.btn} onPress={onPrint}>
        <Text style={styles.icon}>⎙</Text>
        <Text style={styles.label}>Print</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", gap: 8, marginBottom: 12 },
  btn: { flex: 1, backgroundColor: "#1DB954", paddingVertical: 12, borderRadius: 12, alignItems: "center", gap: 3, position: "relative" },
  btnLocked: { backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#2a2a2a" },
  icon: { color: "#000", fontSize: 16, fontWeight: "700" },
  label: { color: "#000", fontWeight: "700", fontSize: 12 },
  lockedText: { color: "#444" },
  lockDot: { position: "absolute", top: 6, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: "#FF4C4C" },
});