import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface Props {
  alcohol?: string;
  date?: string;
  time?: string;
}

export default function DataRow({ alcohol, date, time }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.item}>🍺 {alcohol ?? "0.00"}</Text>
      <Text style={styles.item}>📅 {date ?? "—"}</Text>
      <Text style={styles.item}>⏱ {time ?? "—"}</Text>
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
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  item: { color: "#fff", fontSize: 13 },
});