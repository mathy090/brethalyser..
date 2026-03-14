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
import { storeToken, storeOfficerId, clearSecureStorage } from "./secureStorage";

const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 10_000,
  headers: { "Content-Type": "application/json" },
});

export type AuthResult =
  | { success: true; uid: string }
  | { success: false; error: string };

/**
 * REGISTER:
 * 1. Firebase creates the user
 * 2. Sends verification email
 * 3. Backend (MongoDB) stores officer record
 */
export const registerOfficer = async (
  officerId: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  try {
    const { user }: { user: User } = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user);

    await api.post("/officers/register", {
      officerId,
      email,
      firebaseUid: user.uid,
      // Never send raw password to your own backend — Firebase owns auth
    });

    return { success: true, uid: user.uid };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

/**
 * LOGIN:
 * 1. Firebase verifies credentials, returns idToken
 * 2. Backend validates idToken via Firebase Admin SDK
 * 3. Backend issues its own signed JWT
 * 4. JWT + officerId stored securely in Keychain
 */
export const loginOfficer = async (
  officerId: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  try {
    const { user }: { user: User } = await signInWithEmailAndPassword(auth, email, password);

    // Prove identity to backend with Firebase ID token
    const idToken = await user.getIdToken();

    // Backend verifies token and returns its own JWT
    const { data } = await api.post("/officers/login", { officerId, idToken });

    if (!data?.token) throw new Error("No token returned from server");

    await storeToken(data.token);
    await storeOfficerId(officerId);

    return { success: true, uid: user.uid };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

/** LOGOUT: clears Firebase session + Keychain */
export const logoutOfficer = async (): Promise<void> => {
  await Promise.all([signOut(auth), clearSecureStorage()]);
};