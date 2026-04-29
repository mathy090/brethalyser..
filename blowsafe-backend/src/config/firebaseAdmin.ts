/**
 * src/config/firebaseAdmin.ts
 * Initialize Firebase Admin SDK for server-side auth
 */

import * as admin from "firebase-admin";
import { env } from "./env";

// Initialize once
if (!admin.apps.length) {
  // Option A: Use service account key file (recommended for production)
  // const serviceAccount = require("../../firebase-admin-key.json");
  // admin.initializeApp({
  //   credential: admin.credential.cert(serviceAccount),
  // });

  // Option B: Use application default credentials (Render/GCP)
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

export const auth = admin.auth();
export default admin;