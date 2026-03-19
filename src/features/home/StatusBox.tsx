import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function StatusBox({ message }: any) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{message || "System ready..."}</Text>
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
  },
  text: {
    color: "#ccc",
  },
});