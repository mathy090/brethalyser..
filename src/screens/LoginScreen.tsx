/**
 * src/screens/LoginScreen.tsx
 * Official sign-in with banned/pending status handling
 */

import React, { useState } from "react";
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
  const [status, setStatus] = useState("");
  const routeError = route.params?.error;

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
    setStatus("Verifying credentials...");

    const result = await loginOfficer(
      officerId,
      email.trim().toLowerCase(),
      password
    );

    setLoading(false);
    setStatus("");

    if (result.success) {
      // ✅ Explicit status checks for better UX
      if (result.status === "rejected") {
        Alert.alert(
          "Account Banned",
          "Your account has been banned. Please contact an administrator for assistance.",
          [{ text: "OK", style: "default" }]
        );
        return;
      }

      if (result.status !== "approved") {
        Alert.alert(
          "Pending Approval",
          "Your account is awaiting admin approval. Please wait or contact support.",
          [{ text: "OK", style: "default" }]
        );
        return;
      }

      // ✅ Approved — proceed to app
      await setOfficer({
        uid: result.uid,
        officerId: result.officerId,
        role: result.role as any,
        status: result.status as any,
      });
      navigation.replace("MainApp");
    } else {
      // ✅ Show backend error (includes "Account banned. Contact admin.")
      Alert.alert("Login Failed", result.error);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Official Sign In</Text>
        
        {routeError && <Text style={styles.banner}>{routeError}</Text>}

        <TextInput
          style={styles.input}
          placeholder="Officer ID"
          placeholderTextColor="#666"
          value={officerId}
          onChangeText={setOfficerId}
          autoCapitalize="characters"
          editable={!loading}
          returnKeyType="next"
          onSubmitEditing={() => emailInputRef?.focus()}
        />
        {errors.officerId && <Text style={styles.error}>{errors.officerId}</Text>}

        <TextInput
          ref={(ref) => (emailInputRef = ref)}
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!loading}
          returnKeyType="next"
          onSubmitEditing={() => passwordInputRef?.focus()}
        />
        {errors.email && <Text style={styles.error}>{errors.email}</Text>}

        <TextInput
          ref={(ref) => (passwordInputRef = ref)}
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />
        {errors.password && <Text style={styles.error}>{errors.password}</Text>}

        {status ? <Text style={styles.status}>{status}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotBtn}
          onPress={() => navigation.navigate("ForgotPassword")}
        >
          <Text style={styles.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Refs for keyboard navigation
let emailInputRef: TextInput | null = null;
let passwordInputRef: TextInput | null = null;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  content: {
    padding: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1DB954",
    textAlign: "center",
    marginBottom: 36,
  },
  banner: {
    backgroundColor: "#FF4C4C",
    color: "#fff",
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
    textAlign: "center",
    fontSize: 13,
  },
  input: {
    backgroundColor: "#1e1e1e",
    color: "#fff",
    borderRadius: 8,
    padding: 14,
    marginBottom: 4,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#333",
  },
  error: {
    color: "#FF4C4C",
    fontSize: 12,
    marginBottom: 10,
    marginLeft: 4,
  },
  status: {
    color: "#1DB954",
    fontSize: 13,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 10,
  },
  btn: {
    backgroundColor: "#1DB954",
    padding: 15,
    borderRadius: 25,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 12,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "bold",
  },
  forgotBtn: {
    alignItems: "center",
    marginTop: 8,
  },
  forgotText: {
    color: "#1DB954",
    fontSize: 14,
  },
});