/**
 * src/config/firebase.ts
 *
 * Firebase Admin SDK singleton.
 * Credentials come from the validated env config — no JSON files, no secrets
 * committed to the repository.
 */

import admin from "firebase-admin";

import { env } from "./env";

const app =
  admin.apps.length === 0
    ? admin.initializeApp({
        credential: admin.credential.cert({
          projectId:   env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey:  env.FIREBASE_PRIVATE_KEY,
        }),
      })
    : admin.apps[0]!;

export default admin;