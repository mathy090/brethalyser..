import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StatusBar, StyleSheet, LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";

import AuthNavigator from "./src/navigation/AuthNavigator";
import { Cache } from "./src/utils/cache";
import { auth } from "./secureshell"; // Import firebase auth
import { onAuthStateChanged, User } from "firebase/auth";

// Ignore warnings to prevent hiding logs
LogBox.ignoreAllLogs(true);

export default function App() {
  const [loading, setLoading] = useState(true);
  const [startupData, setStartupData] = useState<{ uid?: string; officerId?: string } | null>(null);

  useEffect(() => {
    const initApp = async () => {
      try {
        // 1️⃣ Check cached startup data
        const cachedUid = await Cache.get("uid");
        const cachedOfficerId = await Cache.get("officerId");

        if (cachedUid) {
          setStartupData({ uid: cachedUid, officerId: cachedOfficerId });
          console.log("🚀 Loaded cached UID:", cachedUid);
        }

        // 2️⃣ Listen for Firebase Auth changes
        onAuthStateChanged(auth, async (user: User | null) => {
          if (user) {
            console.log("🔥 Firebase user detected:", user.uid);
            // Save UID to cache
            await Cache.set("uid", user.uid);

            // If officerId not cached, fetch or wait for registration
            const officerId = cachedOfficerId || "";
            if (officerId) await Cache.set("officerId", officerId);

            setStartupData({ uid: user.uid, officerId });
          } else {
            console.log("⚡ No Firebase user logged in");
            setStartupData(null);
            await Cache.remove("uid");
            await Cache.remove("officerId");
          }
          setLoading(false);
        });
      } catch (err) {
        console.error("⚠️ App initialization error:", err);
        setLoading(false);
      }
    };

    initApp();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer>
        <AuthNavigator startupData={startupData} />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
});