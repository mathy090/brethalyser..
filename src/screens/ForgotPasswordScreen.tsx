/**
 * src/screens/ForgotPasswordScreen.tsx
 * Password reset with precise errors, banners & 15-minute cooldown
 */

import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Animated,
} from "react-native";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../auth/firebaseConfig";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AuthNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

const COOLDOWN_MS = 15 * 60 * 1000;
const STORAGE_KEY = "@blowsafe_reset_cooldown";

const validateEmail = (email: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$/.test(email.toLowerCase());

export default function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState("15:00");

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
    return () => { if (bannerTimeout.current) clearTimeout(bannerTimeout.current); };
  }, []);

  // Load & manage cooldown
  useEffect(() => {
    const checkCooldown = async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const endsAt = parseInt(stored, 10);
        if (Date.now() < endsAt) {
          setCooldownEndsAt(endsAt);
          return;
        }
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
      setCooldownEndsAt(null);
    };
    checkCooldown();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!cooldownEndsAt) return;
    const interval = setInterval(() => {
      const remaining = cooldownEndsAt - Date.now();
      if (remaining <= 0) {
        setCooldownEndsAt(null);
        AsyncStorage.removeItem(STORAGE_KEY);
        setCountdown("00:00");
        clearInterval(interval);
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        setCountdown(`${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownEndsAt]);

  const handleSendReset = async () => {
    if (!validateEmail(email)) {
      showBanner("Please enter a valid email address.", "warning");
      return;
    }
    if (cooldownEndsAt) {
      showBanner(`Please wait ${countdown} before requesting another link.`, "warning");
      return;
    }

    setLoading(true);
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        showBanner("No internet connection. Please check your network.", "error");
        setLoading(false);
        return;
      }

      await sendPasswordResetEmail(auth, email.trim().toLowerCase());

      const endsAt = Date.now() + COOLDOWN_MS;
      setCooldownEndsAt(endsAt);
      await AsyncStorage.setItem(STORAGE_KEY, endsAt.toString());
      setSent(true);
    } catch (err: any) {
      setLoading(false);
      switch (err.code) {
        case "auth/user-not-found": showBanner("No account found with this email.", "warning"); break;
        case "auth/invalid-email": showBanner("Invalid email format.", "warning"); break;
        case "auth/too-many-requests": showBanner("Too many attempts. Wait before retrying.", "warning"); break;
        case "auth/network-request-failed": showBanner("Network error. Check your connection.", "error"); break;
        default: showBanner("Failed to send reset link. Please try again.", "error"); console.warn("Firebase reset error:", err);
      }
    }
  };

  const handleOkPress = () => {
    navigation.navigate("Login", { message: "Password reset link sent. Check your inbox & spam folder." });
  };

  if (sent || cooldownEndsAt) {
    const remaining = cooldownEndsAt ? Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000)) : 0;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const timerDisplay = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {banner && (
            <Animated.View style={[styles.banner, { opacity: bannerAnim, backgroundColor: banner.type === "error" ? "#FF4C4C" : "#FFA500" }]}>
              <Text style={styles.bannerText}>{banner.message}</Text>
            </Animated.View>
          )}
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>✉️</Text>
            <Text style={styles.successTitle}>Check Your Email</Text>
            <Text style={styles.successText}>We've sent a password reset link to{"\n"}<Text style={styles.emailHighlight}>{email}</Text></Text>
            <View style={styles.cooldownBox}>
              <Text style={styles.cooldownLabel}>Next request available in:</Text>
              <Text style={styles.cooldownTimer}>{timerDisplay}</Text>
            </View>
            <View style={styles.bannerStatic}>
              <Text style={styles.bannerIcon}>⚠️</Text>
              <Text style={styles.bannerTextStatic}>Don't see it? Check your spam/junk folder.</Text>
            </View>
            <TouchableOpacity style={styles.okButton} onPress={handleOkPress}>
              <Text style={styles.okButtonText}>OK, Got It</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {banner && (
          <Animated.View style={[styles.banner, { opacity: bannerAnim, backgroundColor: banner.type === "error" ? "#FF4C4C" : banner.type === "warning" ? "#FFA500" : "#1DB954" }]}>
            <Text style={styles.bannerText}>{banner.message}</Text>
          </Animated.View>
        )}
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>Enter your email and we'll send you a reset link.</Text>

        <TextInput style={[styles.input, banner?.type === "error" && styles.inputError]} placeholder="Email address" placeholderTextColor="#666" value={email} onChangeText={(text) => { setEmail(text); if (banner) setBanner(null); }} keyboardType="email-address" autoCapitalize="none" editable={!loading} returnKeyType="send" onSubmitEditing={handleSendReset} />

        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleSendReset} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send Reset Link</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} disabled={loading}>
          <Text style={styles.backText}>← Back to Sign In</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212" },
  content: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "bold", color: "#1DB954", textAlign: "center", marginBottom: 12 },
  subtitle: { color: "#aaa", fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 },
  banner: { padding: 14, borderRadius: 10, marginBottom: 16, alignItems: "center", elevation: 4 },
  bannerText: { color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center" },
  input: { backgroundColor: "#1e1e1e", color: "#fff", borderRadius: 8, padding: 14, marginBottom: 12, fontSize: 15, borderWidth: 1, borderColor: "#333" },
  inputError: { borderColor: "#FF4C4C" },
  btn: { backgroundColor: "#1DB954", padding: 15, borderRadius: 25, alignItems: "center", marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "bold" },
  backBtn: { alignItems: "center", marginTop: 20, padding: 10 },
  backText: { color: "#1DB954", fontSize: 14 },
  successCard: { alignItems: "center", padding: 20 },
  successIcon: { fontSize: 50, marginBottom: 20 },
  successTitle: { color: "#fff", fontSize: 22, fontWeight: "bold", textAlign: "center", marginBottom: 16 },
  successText: { color: "#ccc", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 24 },
  emailHighlight: { color: "#1DB954", fontWeight: "600" },
  cooldownBox: { backgroundColor: "#2A2A2A", borderRadius: 12, padding: 16, marginBottom: 24, alignItems: "center", borderWidth: 1, borderColor: "#3A3A3A" },
  cooldownLabel: { color: "#aaa", fontSize: 12, marginBottom: 4 },
  cooldownTimer: { color: "#1DB954", fontSize: 28, fontWeight: "bold", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  bannerStatic: { backgroundColor: "#2A2A2A", borderRadius: 8, padding: 12, flexDirection: "row", alignItems: "center", marginBottom: 32, borderWidth: 1, borderColor: "#3A3A3A" },
  bannerIcon: { fontSize: 18, marginRight: 8 },
  bannerTextStatic: { color: "#FFA500", fontSize: 13, flex: 1 },
  okButton: { backgroundColor: "#1DB954", paddingHorizontal: 40, paddingVertical: 14, borderRadius: 25 },
  okButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});