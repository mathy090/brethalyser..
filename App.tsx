import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { onAuthStateChanged, User } from "firebase/auth";
import axios from "axios";
import { BACKEND_URL } from "@env";
import AuthNavigator from "./src/navigation/AuthNavigator";
import { auth } from "./src/auth/firebaseConfig";
import { Cache } from "./src/utils/cache";
import { getToken, clearSecureStorage } from "./src/security/secureStorage";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        try {
          // Get cached JWT from Keychain
          const token = await getToken();

          if (token) {
            // Send JWT to backend to verify it is still valid
            const { data } = await axios.post(
              `${BACKEND_URL}/api/auth/verify`,
              {},
              { headers: { Authorization: `Bearer ${token}` } }
            );

            if (data?.valid) {
              // Session restored — go straight to MainApp
              await Cache.set("uid", firebaseUser.uid);
              setIsAuthenticated(true);
            } else {
              // Backend rejected token
              await clearSecureStorage();
              await Cache.clear();
              setIsAuthenticated(false);
            }
          } else {
            // No token cached — needs fresh login
            setIsAuthenticated(false);
          }
        } catch {
          // Token expired or backend error — force re-login
          await clearSecureStorage();
          await Cache.clear();
          setIsAuthenticated(false);
        }
      } else {
        // No Firebase user
        await clearSecureStorage();
        await Cache.clear();
        setIsAuthenticated(false);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AuthNavigator isAuthenticated={isAuthenticated} />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: "#121212",
    justifyContent: "center",
    alignItems: "center",
  },
});