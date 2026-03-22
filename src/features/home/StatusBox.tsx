import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface Props {
  message?: string;
}

export default function StatusBox({ message }: Props) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{message ?? "System ready..."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: "#1a1a1a",
    padding: 14,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#1DB954",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  text: { color: "#ccc", fontSize: 12 },
});