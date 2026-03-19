import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function LicensePreview() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>License Image</Text>

      <View style={styles.preview}>
        <Text style={{ color: "#666" }}>Image Preview Area</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  title: {
    color: "#1DB954",
    marginBottom: 6,
  },
  preview: {
    height: 120,
    borderRadius: 10,
    backgroundColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
});