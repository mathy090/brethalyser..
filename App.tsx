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
import { refreshJWT } from "./src/auth/authService";
import { OfficerProvider, useOfficer } from "./src/context/OfficerContext";

function AppInner() {
  const { setOfficer, clearOfficer } = useOfficer();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        try {
          const token = await getToken();
          if (token) {
            try {
              const { data } = await axios.post(
                `${BACKEND_URL}/api/auth/verify`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (data?.valid) {
                const cached = await Cache.get<any>("officer");
                if (cached) await setOfficer(cached);
                setIsAuthenticated(true);
              } else {
                throw new Error("Invalid");
              }
            } catch {
              const refreshed = await refreshJWT();
              if (refreshed) {
                const cached = await Cache.get<any>("officer");
                if (cached) {
                  await setOfficer({
                    ...cached,
                    role: refreshed.role,
                    status: refreshed.status,
                  });
                }
                setIsAuthenticated(true);
              } else {
                await clearSecureStorage();
                await Cache.clear();
                await clearOfficer();
                setIsAuthenticated(false);
              }
            }
          } else {
            setIsAuthenticated(false);
          }
        } catch {
          await clearSecureStorage();
          await Cache.clear();
          await clearOfficer();
          setIsAuthenticated(false);
        }
      } else {
        await clearSecureStorage();
        await Cache.clear();
        await clearOfficer();
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
    <NavigationContainer>
      <AuthNavigator isAuthenticated={isAuthenticated} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <OfficerProvider>
        <AppInner />
      </OfficerProvider>
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