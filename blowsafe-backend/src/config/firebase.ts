// blowsafe-backend/src/config/firebase.ts
import admin from "firebase-admin";
import { env } from "./env";

let adminAuth: admin.auth.Auth;

export const initFirebaseAdmin = async () => {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  adminAuth = admin.auth();
  return adminAuth;
};

// ✅ Export for routes that need direct Firebase Admin access
export { adminAuth };
export default admin;