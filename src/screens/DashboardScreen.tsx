import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Superadmin Dashboard</Text>
      <Text style={styles.sub}>Officer management coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212", justifyContent: "center", alignItems: "center", paddingBottom: 100 },
  title: { color: "#1DB954", fontSize: 24, fontWeight: "bold" },
  sub: { color: "#666", marginTop: 10 },
});