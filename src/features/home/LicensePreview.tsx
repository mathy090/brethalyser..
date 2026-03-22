import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";

interface Props {
  photoUri: string | null;
}

export default function LicensePreview({ photoUri }: Props) {
  if (!photoUri) return null;

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.title}>Licence Photo</Text>
        <View style={s.badge}>
          <Text style={s.badgeText}>Waiting for upload</Text>
        </View>
      </View>
      <Image source={{ uri: photoUri }} style={s.photo} resizeMode="cover" />
    </View>
  );
}

const s = StyleSheet.create({
  card:      { backgroundColor: "#1a1a1a", borderRadius: 12, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: "rgba(29,185,84,0.2)" },
  header:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10 },
  title:     { color: "#1DB954", fontSize: 12, fontWeight: "700" },
  badge:     { backgroundColor: "rgba(29,185,84,0.08)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: "rgba(29,185,84,0.2)" },
  badgeText: { color: "#1DB954", fontSize: 9, fontWeight: "700" },
  photo:     { width: "100%", height: 160 },
});