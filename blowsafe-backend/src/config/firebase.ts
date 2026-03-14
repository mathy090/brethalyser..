import admin from "firebase-admin";

// Load from env — no JSON file needed, no secrets in repo
const app = admin.apps.length === 0
  ? admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Bun reads \n literally from .env — this fixes it
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  : admin.apps[0]!;

export default admin;