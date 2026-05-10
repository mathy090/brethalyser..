/**
 * src/routes/register.ts
 *
 * Officer self-registration.
 *
 * Flow:
 *  1. Validate input
 *  2. Check MongoDB for duplicate officerId
 *  3. Check Firebase for duplicate email
 *  4. Create Firebase user (Admin SDK)
 *  5. Firebase sends verification email directly (via REST API — no mailer)
 *  6. Create MongoDB officer record
 *
 * Why REST API for the email?
 *  Admin SDK can generate a verification link but cannot send it.
 *  The client SDK can send it but runs in the browser.
 *  Solution: create a custom token → exchange for ID token → call
 *  the Firebase sendOobCode endpoint, which triggers Firebase's own
 *  email delivery to the user's address.
 */

import { Router, type Request, type Response } from "express";
import axios from "axios";

import admin from "../config/firebase";
import { Officer } from "../models/Officer";
import { env } from "../config/env";

const router = Router();

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(body: Record<string, unknown>): { code: string; message: string } | null {
  const { officerId, email, password } = body as Record<string, string>;

  if (!officerId?.trim() || !/^[A-Z]\d{6}[A-Z]$|^\d{9}$/i.test(officerId.trim())) {
    return { code: "INVALID_OFFICER_ID", message: "Invalid Officer ID format (e.g. A123456B)" };
  }
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
    return { code: "INVALID_EMAIL", message: "Invalid email address" };
  }
  if (!password || password.length < 6) {
    return { code: "WEAK_PASSWORD", message: "Password must be at least 6 characters" };
  }

  return null;
}

// ─── Firebase email verification via REST API ─────────────────────────────────
// Firebase Admin SDK creates the user but cannot send emails on its own.
// We obtain an ID token by exchanging a custom token, then call Firebase's
// sendOobCode endpoint so Firebase delivers the verification email itself.

async function sendFirebaseVerificationEmail(uid: string): Promise<void> {
  const API_KEY = env.FIREBASE_WEB_API_KEY;

  // Step 1: Create a short-lived custom token for this uid
  const customToken = await admin.auth().createCustomToken(uid);

  // Step 2: Exchange custom token → ID token (Firebase REST)
  const { data: signInData } = await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    { token: customToken, returnSecureToken: true },
    { timeout: 8_000 }
  );

  const idToken: string = signInData.idToken;

  // Step 3: Ask Firebase to send the verification email to the user
  await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
    { requestType: "VERIFY_EMAIL", idToken },
    { timeout: 8_000 }
  );
}

// ─── POST / ───────────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { officerId, email, password } = req.body as Record<string, string>;

  const normId    = officerId?.toUpperCase().trim();
  const normEmail = email?.toLowerCase().trim();

  // 1. Validate
  const err = validate({ officerId: normId, email: normEmail, password });
  if (err) {
    return res.status(400).json({ success: false, code: err.code, error: err.message });
  }

  // 2. Check MongoDB — duplicate Officer ID
  const existingById = await Officer.findOne({ officerId: normId });
  if (existingById) {
    return res.status(409).json({
      success: false,
      code: "OFFICER_ID_IN_USE",
      error: "Please use your official ZRP officer ID",
    });
  }

  // 3. Check Firebase — duplicate email
  try {
    await admin.auth().getUserByEmail(normEmail);
    return res.status(409).json({
      success: false,
      code: "EMAIL_EXISTS",
      error: "An account with this email already exists",
    });
  } catch (firebaseErr: any) {
    if (firebaseErr.code !== "auth/user-not-found") {
      console.error("[Register] Firebase email check failed:", firebaseErr.message);
      return res.status(500).json({
        success: false,
        code: "FIREBASE_CHECK_FAILED",
        error: "Unable to verify email availability",
      });
    }
    // auth/user-not-found → email is available, continue
  }

  // 4. Create Firebase user
  let firebaseUser: admin.auth.UserRecord;
  try {
    firebaseUser = await admin.auth().createUser({
      email: normEmail,
      password,
      emailVerified: false,
    });
  } catch (firebaseErr: any) {
    if (firebaseErr.code === "auth/email-already-exists") {
      return res.status(409).json({
        success: false,
        code: "EMAIL_EXISTS",
        error: "An account with this email already exists",
      });
    }
    console.error("[Register] Firebase createUser failed:", firebaseErr.message);
    return res.status(500).json({
      success: false,
      code: "FIREBASE_CREATE_FAILED",
      error: "Failed to create account",
    });
  }

  // 5. Firebase sends verification email (no mailer needed)
  try {
    await sendFirebaseVerificationEmail(firebaseUser.uid);
  } catch (emailErr: any) {
    // Non-fatal: account exists, email just didn't send. Log and continue.
    // User can request a new link from the login screen.
    console.warn("[Register] Verification email failed (non-fatal):", emailErr.message);
  }

  // 6. Create MongoDB record
  try {
    await Officer.create({
      officerId:   normId,
      email:       normEmail,
      firebaseUid: firebaseUser.uid,
      role:        "officer",
      status:      "approved",
      createdAt:   new Date(),
    });
  } catch (dbErr: any) {
    // MongoDB failed — clean up the Firebase user so state stays consistent
    await admin.auth().deleteUser(firebaseUser.uid).catch(() => {});

    if (dbErr.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "OFFICER_ID_IN_USE",
        error: "Officer ID already registered",
      });
    }

    console.error("[Register] MongoDB create failed:", dbErr.message);
    return res.status(500).json({
      success: false,
      code: "DATABASE_ERROR",
      error: "Failed to save officer record",
    });
  }

  console.log(`[Register] ✅ Officer registered: ${normId} (${normEmail})`);

  return res.status(201).json({
    success: true,
    code: "ACCOUNT_CREATED",
    message: "Account created. Check your email to verify before signing in.",
  });
});

export default router;