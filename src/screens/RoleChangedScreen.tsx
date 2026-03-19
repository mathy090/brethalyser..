import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useOfficer } from "../context/OfficerContext";
import { logoutOfficer } from "../auth/authService";
import { useNavigation } from "@react-navigation/native";

export default function RoleChangedScreen() {
  const { clearOfficer, acknowledgeRoleChange } = useOfficer();
  const navigation = useNavigation<any>();

  const handleRelogin = async () => {
    acknowledgeRoleChange();
    await logoutOfficer();
    await clearOfficer();
    navigation.replace("Login");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔐</Text>
      <Text style={styles.title}>Access Level Changed</Text>
      <Text style={styles.sub}>
        Your access level has been updated by an administrator.
        Please sign in again to continue with your new permissions.
      </Text>
      <TouchableOpacity style={styles.btn} onPress={handleRelogin}>
        <Text style={styles.btnText}>Sign In Again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  icon: { fontSize: 60, marginBottom: 24 },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 16,
  },
  sub: {
    color: "#aaa",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 40,
  },
  btn: {
    backgroundColor: "#1DB954",
    paddingVertical: 15,
    paddingHorizontal: 50,
    borderRadius: 30,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});