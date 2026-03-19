import React, { useState } from "react";
import {
  Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
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
      await setOfficer({
        uid: result.uid,
        officerId: result.officerId,
        role: result.role as any,
        status: result.status as any,
      });
      navigation.replace("MainApp");
    } else {
      Alert.alert("Login Failed", result.error);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Official Sign In</Text>
      {routeError && <Text style={styles.banner}>{routeError}</Text>}

      <TextInput style={styles.input} placeholder="Officer ID"
        placeholderTextColor="#666" value={officerId} onChangeText={setOfficerId}
        autoCapitalize="characters" editable={!loading} />
      {errors.officerId && <Text style={styles.error}>{errors.officerId}</Text>}

      <TextInput style={styles.input} placeholder="Email"
        placeholderTextColor="#666" value={email} onChangeText={setEmail}
        keyboardType="email-address" autoCapitalize="none" editable={!loading} />
      {errors.email && <Text style={styles.error}>{errors.email}</Text>}

      <TextInput style={styles.input} placeholder="Password"
        placeholderTextColor="#666" value={password} onChangeText={setPassword}
        secureTextEntry editable={!loading} />
      {errors.password && <Text style={styles.error}>{errors.password}</Text>}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Sign In</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212" },
  content: { padding: 24, paddingTop: 80 },
  title: { fontSize: 28, fontWeight: "bold", color: "#1DB954", textAlign: "center", marginBottom: 36 },
  banner: { backgroundColor: "#FF4C4C", color: "#fff", padding: 10, borderRadius: 6, marginBottom: 16, textAlign: "center" },
  input: { backgroundColor: "#1e1e1e", color: "#fff", borderRadius: 8, padding: 14, marginBottom: 4, fontSize: 15 },
  error: { color: "#FF4C4C", fontSize: 12, marginBottom: 10 },
  status: { color: "#1DB954", fontSize: 13, textAlign: "center", marginTop: 10 },
  btn: { backgroundColor: "#1DB954", padding: 15, borderRadius: 25, alignItems: "center", marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "bold" },
});