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
  | { success: true; uid: string }
  | { success: false; error: string };

export const registerOfficer = async (
  officerId: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  try {
    const { user }: { user: User } = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user);
    return { success: true, uid: user.uid };
  } catch (error: any) {
    return { success: false, error: error.message };
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

    // Step 3 — Send to backend, backend verifies with Firebase Admin SDK
    const { data } = await api.post("/api/auth/login", { officerId, idToken });

    if (!data?.token) throw new Error("Backend did not return a token");

    // Step 4 — Store JWT in Keychain (secure hardware storage)
    await storeToken(data.token);
    await storeOfficerId(officerId);

    // Step 5 — Cache session data for app restart
    await Cache.set("session", {
      uid: user.uid,
      officerId,
      email: user.email,
      lastLogin: Date.now(),
    });

    return { success: true, uid: user.uid };
  } catch (error: any) {
    await signOut(auth);
    return { success: false, error: error.message };
  }
};

export const logoutOfficer = async (): Promise<void> => {
  await signOut(auth);
  await clearSecureStorage();
  await Cache.clear();
};