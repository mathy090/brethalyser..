import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, NavigationContainerRef } from "@react-navigation/native";
import { onAuthStateChanged, type User } from "firebase/auth";
import { BACKEND_URL } from "@env";
import AuthNavigator from "./src/navigation/AuthNavigator";
import { auth } from "./src/auth/firebaseConfig";
import { Cache } from "./src/utils/cache";
import { getToken, clearSecureStorage } from "./src/security/secureStorage";
import { refreshJWT } from "./src/auth/authService";
import { OfficerProvider, useOfficer } from "./src/context/OfficerContext";
import { BreathalyserProvider } from "./src/context/BreathalyserContext";
import { useSessionGuard } from "./src/hooks/useSessionGuard";
import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import type { RootStackParamList } from "./src/navigation/AuthNavigator";

function AppInner() {
  const { setOfficer, clearOfficer }          = useOfficer();
  const [loading, setLoading]                 = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  const handleSessionInvalid = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  useSessionGuard({ onSessionInvalid: handleSessionInvalid });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (!firebaseUser) {
        await clearSecureStorage();
        await Cache.clear();
        await clearOfficer();
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }

      const cached = await Cache.get<any>("officer");
      const token  = await getToken();

      if (cached && token) {
        await setOfficer(cached);
        setIsAuthenticated(true);
        setLoading(false);

        const net = await NetInfo.fetch();
        if (net.isConnected && net.isInternetReachable) {
          try {
            const { data } = await axios.post(
              `${BACKEND_URL}/api/auth/verify`,
              {},
              { headers: { Authorization: `Bearer ${token}` }, timeout: 8_000 }
            );
            if (!data?.valid) throw new Error("invalid");
          } catch (err: any) {
            if (!err.response) return;
            const refreshed = await refreshJWT();
            if (refreshed && cached) {
              await setOfficer({ ...cached, role: refreshed.role, status: refreshed.status });
            } else {
              await clearSecureStorage();
              await Cache.clear();
              await clearOfficer();
              setIsAuthenticated(false);
            }
          }
        }
        return;
      }

      await clearSecureStorage();
      await Cache.clear();
      await clearOfficer();
      setIsAuthenticated(false);
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
    <NavigationContainer ref={navigationRef}>
      <AuthNavigator isAuthenticated={isAuthenticated} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <OfficerProvider>
        <BreathalyserProvider>
          <AppInner />
        </BreathalyserProvider>
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