import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function DataRow({ alcohol, date, time }: any) {
  return (
    <View style={styles.row}>
      <Text style={styles.item}>🍺 {alcohol || "0.00"}</Text>
      <Text style={styles.item}>📅 {date || "Auto"}</Text>
      <Text style={styles.item}>⏱ {time || "Auto"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  item: {
    color: "#fff",
    fontSize: 13,
  },
});