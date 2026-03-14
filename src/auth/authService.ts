import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  User,
} from "firebase/auth";
import { auth } from "./firebaseConfig";

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
    const { user }: { user: User } = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, uid: user.uid };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const logoutOfficer = async (): Promise<void> => {
  await signOut(auth);
};