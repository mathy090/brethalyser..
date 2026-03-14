import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { logoutOfficer } from "../auth/authService";
import { useNavigation } from "@react-navigation/native";

export default function SettingsScreen() {
  const navigation = useNavigation<any>();

  const handleLogout = async () => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await logoutOfficer();
          navigation.replace("Welcome");
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212", justifyContent: "center", alignItems: "center" },
  title: { color: "#1DB954", fontSize: 24, fontWeight: "bold", marginBottom: 40 },
  logoutBtn: { borderColor: "#FF4C4C", borderWidth: 1.5, borderRadius: 25, paddingVertical: 12, paddingHorizontal: 32 },
  logoutText: { color: "#FF4C4C", fontWeight: "600", fontSize: 15 },
});