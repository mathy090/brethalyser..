/**
 * src/screens/LoginScreen.tsx
 * Unified animated banners for backend errors & success messages
 */

import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Animated,
} from "react-native";
import { loginOfficer } from "../auth/authService";
import { useOfficer } from "../context/OfficerContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AuthNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

const validateOfficerId = (id: string) => /^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i.test(id);
const validateEmail = (e: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$/.test(e);

export default function LoginScreen({ navigation, route }: Props) {
  const { setOfficer } = useOfficer();
  const [officerId, setOfficerId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Banner system
  const [banner, setBanner] = useState<{ message: string; type: "error" | "warning" | "success" } | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerTimeout = useRef<NodeJS.Timeout | null>(null);

  const showBanner = (message: string, type: "error" | "warning" | "success" = "error", duration = 3500) => {
    if (bannerTimeout.current) clearTimeout(bannerTimeout.current);
    setBanner({ message, type });
    bannerAnim.setValue(0);
    Animated.timing(bannerAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    
    bannerTimeout.current = setTimeout(() => {
      Animated.timing(bannerAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setBanner(null));
    }, duration);
  };

  useEffect(() => {
    // Auto-show success message from ForgotPassword screen
    if (route.params?.message) {
      showBanner(route.params.message, "success", 4000);
      // Clear params after showing
      navigation.setParams({ message: undefined });
    }
    return () => {
      if (bannerTimeout.current) clearTimeout(bannerTimeout.current);
    };
  }, [route.params?.message]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!validateOfficerId(officerId)) e.officerId = "Invalid Officer ID";
    if (!validateEmail(email)) e.email = "Invalid email";
    if (!password) e.password = "Password required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);

    const result = await loginOfficer(officerId, email.trim().toLowerCase(), password);
    setLoading(false);

    if (result.success) {
      if (result.status === "rejected") {
        showBanner("Account banned. Contact admin.", "warning");
        return;
      }

      await setOfficer({ uid: result.uid, officerId: result.officerId, role: result.role as any, status: result.status as any });
      navigation.replace("MainApp");
    } else {
      const msg = result.error.toLowerCase().includes("network") || result.error.toLowerCase().includes("connection")
        ? "Poor internet. Couldn't login."
        : result.error;
      showBanner(msg, "error");
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {banner && (
          <Animated.View style={[styles.banner, { opacity: bannerAnim, backgroundColor: banner.type === "error" ? "#FF4C4C" : banner.type === "warning" ? "#FFA500" : "#1DB954" }]}>
            <Text style={styles.bannerText}>{banner.message}</Text>
          </Animated.View>
        )}

        <Text style={styles.title}>Official Sign In</Text>

        <TextInput style={styles.input} placeholder="Officer ID" placeholderTextColor="#666" value={officerId} onChangeText={(t) => { setOfficerId(t); setErrors((e) => ({ ...e, officerId: "" })); }} autoCapitalize="characters" editable={!loading} />
        {errors.officerId && <Text style={styles.error}>{errors.officerId}</Text>}

        <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={(t) => { setEmail(t); setErrors((e) => ({ ...e, email: "" })); }} keyboardType="email-address" autoCapitalize="none" editable={!loading} />
        {errors.email && <Text style={styles.error}>{errors.email}</Text>}

        <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" value={password} onChangeText={(t) => { setPassword(t); setErrors((e) => ({ ...e, password: "" })); }} secureTextEntry editable={!loading} />
        {errors.password && <Text style={styles.error}>{errors.password}</Text>}

        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign In</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.forgotBtn} onPress={() => navigation.navigate("ForgotPassword")}>
          <Text style={styles.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212" },
  content: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "bold", color: "#1DB954", textAlign: "center", marginBottom: 30 },
  banner: { padding: 14, borderRadius: 10, marginBottom: 16, alignItems: "center", elevation: 4 },
  bannerText: { color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center" },
  input: { backgroundColor: "#1e1e1e", color: "#fff", borderRadius: 8, padding: 14, marginBottom: 4, fontSize: 15, borderWidth: 1, borderColor: "#333" },
  error: { color: "#FF4C4C", fontSize: 12, marginBottom: 10, marginLeft: 4 },
  btn: { backgroundColor: "#1DB954", padding: 15, borderRadius: 25, alignItems: "center", marginTop: 20 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "bold" },
  forgotBtn: { alignItems: "center", marginTop: 16, padding: 10 },
  forgotText: { color: "#1DB954", fontSize: 14 },
});