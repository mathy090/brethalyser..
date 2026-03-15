import React from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Image,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOfficer } from "../context/OfficerContext";
import { useNetworkStatus } from "../helpers/network";

export default function HomeScreen() {
  const { officer } = useOfficer();
  const { isConnected } = useNetworkStatus();

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />

      {/* Top bar */}
      <View style={styles.topBar}>

        {/* Left — round avatar icon */}
        <TouchableOpacity style={styles.avatarContainer}>
          <Image
            source={require("../../assets/background.png")}
            style={styles.avatar}
          />
        </TouchableOpacity>

        {/* Center — dynamic island style pill */}
        <View style={styles.island}>
          <Text style={styles.islandText}>BlowSafe</Text>
        </View>

        {/* Right — status indicator */}
        <View style={styles.topRight}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? "#1DB954" : "#FF4C4C" }]} />
          <Text style={styles.statusText}>{isConnected ? "Online" : "Offline"}</Text>
        </View>

      </View>

      {/* Main content */}
      <View style={styles.content}>
        <Text style={styles.welcome}>Welcome back</Text>
        <Text style={styles.name}>Officer {officer?.officerId}</Text>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#121212",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  avatarContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#1DB954",
  },
  avatar: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  island: {
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  islandText: {
    color: "#1DB954",
    fontSize: 15,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    minWidth: 80,
    justifyContent: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 100,
  },
  welcome: {
    color: "#888",
    fontSize: 16,
    marginBottom: 6,
  },
  name: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "bold",
  },
});