import React, { useState } from "react";
import {
  Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { registerOfficer } from "../services/authService";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AuthNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

const validateOfficerId = (id: string) => /^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i.test(id);
const validateEmail = (e: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$/.test(e);
const validatePassword = (pw: string) =>
  pw.length >= 8 && /[A-Z]/.test(pw) && /[!@#$%^&*]/.test(pw);

export default function RegisterScreen({ navigation }: Props) {
  const [officerId, setOfficerId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!validateOfficerId(officerId)) e.officerId = "Invalid Officer ID (e.g. A123456B)";
    if (!validateEmail(email)) e.email = "Invalid email address";
    if (!validatePassword(password)) e.password = "Min 8 chars, 1 uppercase, 1 special character";
    if (password !== confirm) e.confirm = "Passwords do not match";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      Alert.alert("No Connection", "Check your internet and try again.");
      return;
    }

    setLoading(true);
    const result = await registerOfficer(officerId, email, password);
    setLoading(false);

    if (result.success) {
      Alert.alert(
        "Check Your Email",
        "A verification link has been sent. Confirm it before signing in.",
        [{ text: "OK", onPress: () => navigation.replace("Login") }]
      );
    } else {
      Alert.alert("Registration Failed", result.error);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>ZRP Officer Registration</Text>

      <TextInput style={styles.input} placeholder="Officer ID (e.g. A123456B)"
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

      <TextInput style={styles.input} placeholder="Confirm Password"
        placeholderTextColor="#666" value={confirm} onChangeText={setConfirm}
        secureTextEntry editable={!loading} />
      {errors.confirm && <Text style={styles.error}>{errors.confirm}</Text>}

      <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleRegister} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Register</Text>}
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        ⚠️ Unauthorized use is a criminal offence. Only ZRP officers may register.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212" },
  content: { padding: 24, paddingTop: 60 },
  title: { fontSize: 26, fontWeight: "bold", color: "#1DB954", textAlign: "center", marginBottom: 32 },
  input: { backgroundColor: "#1e1e1e", color: "#fff", borderRadius: 8, padding: 14, marginBottom: 4, fontSize: 15 },
  error: { color: "#FF4C4C", fontSize: 12, marginBottom: 10 },
  btn: { backgroundColor: "#1DB954", padding: 15, borderRadius: 25, alignItems: "center", marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "bold" },
  disclaimer: { color: "#666", fontSize: 11, textAlign: "center", marginTop: 20, lineHeight: 17 },
});