import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useOfficer } from "../context/OfficerContext";

export default function HomeScreen() {
  const { officer } = useOfficer();
  const isPending = officer?.status === "pending";
  const isRejected = officer?.status === "rejected";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BlowSafe</Text>

      {isPending && (
        <View style={styles.banner}>
          <Text style={styles.icon}>⏳</Text>
          <Text style={styles.bannerTitle}>Awaiting Approval</Text>
          <Text style={styles.bannerSub}>
            Your account is pending admin approval. Some features are restricted until approved.
          </Text>
        </View>
      )}

      {isRejected && (
        <View style={[styles.banner, styles.rejected]}>
          <Text style={styles.icon}>❌</Text>
          <Text style={styles.bannerTitle}>Account Rejected</Text>
          <Text style={styles.bannerSub}>
            Your registration was rejected. Contact your administrator.
          </Text>
        </View>
      )}

      {!isPending && !isRejected && (
        <Text style={styles.sub}>Welcome, Officer {officer?.officerId}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212", justifyContent: "center", alignItems: "center", padding: 24, paddingBottom: 100 },
  title: { color: "#1DB954", fontSize: 28, fontWeight: "bold", marginBottom: 30 },
  sub: { color: "#fff", fontSize: 16 },
  banner: {
    backgroundColor: "rgba(255,165,0,0.1)",
    borderColor: "rgba(255,165,0,0.3)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    width: "100%",
  },
  rejected: {
    backgroundColor: "rgba(255,76,76,0.1)",
    borderColor: "rgba(255,76,76,0.3)",
  },
  icon: { fontSize: 40, marginBottom: 12 },
  bannerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold", marginBottom: 8 },
  bannerSub: { color: "#aaa", fontSize: 13, textAlign: "center", lineHeight: 20 },
});