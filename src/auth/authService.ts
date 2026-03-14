import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  User,
} from "firebase/auth";
import { auth } from "./firebaseConfig";
import axios from "axios";
import { BACKEND_URL } from "@env";
import { storeToken, storeOfficerId, clearSecureStorage } from "../security/secureStorage";
import { Cache } from "../utils/cache";

const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 10_000,
  headers: { "Content-Type": "application/json" },
});

export type AuthResult =
  | { success: true; uid: string; role: string; status: string; officerId: string }
  | { success: false; error: string };

export const registerOfficer = async (
  officerId: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  try {
    const { user }: { user: User } = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user);
    const idToken = await user.getIdToken();

    await api.post(
      "/api/auth/register",
      { officerId, email },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    return { success: true, uid: user.uid, role: "officer", status: "approved", officerId };
  } catch (error: any) {
    if (!error.response) return { success: false, error: "Network error. Check your connection." };
    return { success: false, error: error.response?.data?.message || error.message };
  }
};

export const loginOfficer = async (
  officerId: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  try {
    // Step 1 — Firebase verifies credentials
    const { user }: { user: User } = await signInWithEmailAndPassword(auth, email, password);

    // Step 2 — Get Firebase ID token
    const idToken = await user.getIdToken();

    // Step 3 — Backend verifies token + checks MongoDB for role
    const { data } = await api.post(
      "/api/auth/login",
      { officerId },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    if (!data?.token) throw new Error("Backend did not return a token");

    // Step 4 — Store JWT securely
    await storeToken(data.token);
    await storeOfficerId(officerId);
    await Cache.set("refreshToken", data.refreshToken);
    await Cache.set("session", {
      uid: user.uid,
      officerId,
      email: user.email,
      lastLogin: Date.now(),
    });

    // Step 5 — Return role and status from backend
    return {
      success: true,
      uid: user.uid,
      role: data.role,
      status: data.status,
      officerId,
    };
  } catch (error: any) {
    await signOut(auth).catch(() => {});
    if (!error.response && !error.code?.startsWith("auth/")) {
      return { success: false, error: "Network error. Check your connection." };
    }
    if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
      return { success: false, error: "Invalid credentials." };
    }
    if (error.code === "auth/too-many-requests") {
      return { success: false, error: "Too many attempts. Try again later." };
    }
    return { success: false, error: error.response?.data?.message || error.message || "Login failed." };
  }
};

export const refreshJWT = async (): Promise<{ token: string; role: string; status: string } | null> => {
  try {
    const refreshToken = await Cache.get<string>("refreshToken");
    if (!refreshToken) return null;
    const { data } = await api.post("/api/auth/refresh", { refreshToken });
    if (data?.token) {
      await storeToken(data.token);
      return { token: data.token, role: data.role, status: data.status };
    }
    return null;
  } catch {
    return null;
  }
};

export const logoutOfficer = async (): Promise<void> => {
  await signOut(auth);
  await clearSecureStorage();
  await Cache.clear();
};