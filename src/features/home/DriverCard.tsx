import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function DriverCard({ name, id, vehicle }: any) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Driver Info</Text>

      <Text style={styles.label}>Name: <Text style={styles.value}>{name || "-"}</Text></Text>
      <Text style={styles.label}>ID No: <Text style={styles.value}>{id || "-"}</Text></Text>
      <Text style={styles.label}>Vehicle: <Text style={styles.value}>{vehicle || "-"}</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1a1a",
    padding: 15,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  title: {
    color: "#1DB954",
    fontWeight: "bold",
    marginBottom: 8,
  },
  label: {
    color: "#aaa",
    marginBottom: 4,
  },
  value: {
    color: "#fff",
  },
});