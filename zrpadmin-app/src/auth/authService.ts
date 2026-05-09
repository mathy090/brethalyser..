// src/auth/authService.ts
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  User,
} from "firebase/auth";
import { auth } from "./firebaseConfig";
import axios from "axios";

// Backend API instance
const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  timeout: 10_000,
  headers: { "Content-Type": "application/json" },
});

export type AuthResult =
  | { success: true; uid: string; role: string; status: string; officerId: string; idToken?: string }
  | { success: false; error: string };

// ===== ✅ SIGNUP: Firebase SDK → Backend =====
export const registerOfficer = async (
  officerId: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user);
    const idToken = await user.getIdToken();

    await api.post(
      "/api/auth/register",
      { officerId, email },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    return { 
      success: true, 
      uid: user.uid, 
      role: "officer", 
      status: "pending", 
      officerId,
      idToken 
    };
  } catch (error: any) {
    if (error.code === "auth/email-already-in-use") {
      return { success: false, error: "This email is already registered." };
    }
    if (error.code === "auth/weak-password") {
      return { success: false, error: "Password must be at least 6 characters." };
    }
    if (error.code === "auth/invalid-email") {
      return { success: false, error: "Invalid email address." };
    }
    if (!error.response && !error.code?.startsWith("auth/")) {
      return { success: false, error: "Network error. Check your connection." };
    }
    return { 
      success: false, 
      error: error.response?.data?.message || error.message || "Registration failed" 
    };
  }
};

// ===== ✅ LOGIN: Firebase → Backend (THIS WAS MISSING) =====
export const loginOfficer = async (
  officerId: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  try {
    // Step 1: Firebase verifies credentials
    const { user } = await signInWithEmailAndPassword(auth, email, password);

    // Step 2: Get Firebase ID token
    const idToken = await user.getIdToken();

    // Step 3: Backend verifies token + returns role/JWT
    const { data } = await api.post(
      "/api/auth/login",
      { officerId },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    if (!data?.token) throw new Error("Backend did not return a token");

    // Step 4: Store JWT in localStorage
    localStorage.setItem("jwt_token", data.token);
    localStorage.setItem("officer_id", officerId);
    localStorage.setItem("user_uid", user.uid);

    return {
      success: true,
      uid: user.uid,
      role: data.role,
      status: data.status,
      officerId,
      idToken,
    };
  } catch (error: any) {
    await signOut(auth).catch(() => {});

    if (!error.response && !error.code?.startsWith("auth/")) {
      return { success: false, error: "Network error. Check your connection." };
    }
    if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
      return { success: false, error: "Invalid email or password." };
    }
    if (error.code === "auth/user-not-found") {
      return { success: false, error: "No account found with this email." };
    }
    if (error.code === "auth/too-many-requests") {
      return { success: false, error: "Too many attempts. Try again later." };
    }
    return { 
      success: false, 
      error: error.response?.data?.message || error.message || "Login failed." 
    };
  }
};

// ===== LOGOUT =====
export const logoutOfficer = async (): Promise<void> => {
  await signOut(auth);
  localStorage.removeItem("jwt_token");
  localStorage.removeItem("officer_id");
  localStorage.removeItem("user_uid");
};