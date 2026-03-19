import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useOfficer } from "../context/OfficerContext";
import { logoutOfficer } from "../auth/authService";
import { useNavigation } from "@react-navigation/native";

export default function SettingsScreen() {
  const { officer, clearOfficer } = useOfficer();
  const navigation = useNavigation<any>();

  const handleLogout = async () => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await logoutOfficer();
          await clearOfficer();
          navigation.replace("Welcome");
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Officer ID</Text>
        <Text style={styles.value}>{officer?.officerId ?? "—"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Role</Text>
        <Text style={[styles.value, styles.green]}>{officer?.role ?? "—"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Status</Text>
        <Text style={[styles.value, styles.green]}>{officer?.status ?? "—"}</Text>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212", padding: 24, paddingTop: 60, paddingBottom: 100 },
  title: { color: "#1DB954", fontSize: 24, fontWeight: "bold", marginBottom: 30 },
  card: { backgroundColor: "#1e1e1e", borderRadius: 12, padding: 16, marginBottom: 12 },
  label: { color: "#666", fontSize: 12, marginBottom: 4 },
  value: { color: "#fff", fontSize: 16, fontWeight: "600" },
  green: { color: "#1DB954" },
  logoutBtn: { marginTop: 30, borderColor: "#FF4C4C", borderWidth: 1.5, borderRadius: 25, paddingVertical: 14, alignItems: "center" },
  logoutText: { color: "#FF4C4C", fontWeight: "600", fontSize: 15 },
});