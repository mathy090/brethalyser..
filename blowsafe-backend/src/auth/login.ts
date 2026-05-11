/**
 * blowsafe-backend/src/auth/login.ts
 * 
 * Production login: Firebase Auth + MongoDB Read-Only Status Check
 * 
 * Session Strategy:
 * • Officers: JWT-only session (HTTP Authorization header)
 * • Admins/Superadmins: JWT for API + WebSocket for session persistence
 * 
 * Flow:
 * 1. Verify Firebase ID token (proves password is correct)
 * 2. READ officer from MongoDB (ZERO writes)
 * 3. Validate email match + account status == "approved"
 * 4. Issue short-lived BlowSafe JWT with user metadata
 * 5. Log audit event with role differentiation (fire-and-forget)
 * 
 * ⚠️ NO MongoDB writes. NO updates. NO inserts. Pure read-only validation.
 */

import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { getDb } from "../config/mongo";
import { logAudit } from "../utils/auditLogger";

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────

interface OfficerDocument {
  officerId: string;
  email: string;
  role: "admin" | "officer" | "superadmin";
  status: "approved" | "pending" | "rejected" | "banned";
}

interface LoginRequest {
  officerId: string;
}

interface LoginSuccessResponse {
  token: string;
  uid: string;
  email: string;
  officerId: string;
  role: OfficerDocument["role"];
  status: OfficerDocument["status"];
  // 🔐 Frontend uses this to decide session persistence method
  sessionType: "http" | "websocket";
}

interface LoginErrorResponse {
  success: false;
  code: string;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const normalizeOfficerId = (id: string): string => id.trim().toUpperCase();
const STRICT_ROLES = new Set(["admin", "superadmin"]);

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.headers["x-request-id"] || Math.random().toString(36).slice(2);
  const clientIp =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.ip ||
    "unknown";

  try {
    // ── 1. Extract & validate Authorization header ───────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      const error: LoginErrorResponse = {
        success: false,
        code: "MISSING_TOKEN",
        message: "Missing Firebase ID token.",
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        success: false,
        reason: "missing_token",
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(401).json(error);
    }

    const idToken = authHeader.split("Bearer ")[1].trim();
    if (!idToken) {
      const error: LoginErrorResponse = {
        success: false,
        code: "INVALID_TOKEN_FORMAT",
        message: "Invalid token format.",
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        success: false,
        reason: "invalid_token_format",
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(401).json(error);
    }

    // ── 2. Verify token with Firebase Admin SDK ──────────────────────────────
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err: any) {
      const isFirebaseAuthError = err.code?.startsWith("auth/");
      const error: LoginErrorResponse = {
        success: false,
        code: isFirebaseAuthError ? "INVALID_TOKEN" : "TOKEN_VERIFICATION_FAILED",
        message: isFirebaseAuthError ? "Invalid or expired Firebase token." : "Token verification failed.",
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        success: false,
        reason: isFirebaseAuthError ? "invalid_firebase_token" : "token_verification_failed",
        firebaseUid: err.uid || null,
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(401).json(error);
    }

    const firebaseUid = decoded.uid;
    const firebaseEmail = decoded.email?.toLowerCase();

    if (!firebaseEmail) {
      const error: LoginErrorResponse = {
        success: false,
        code: "MISSING_FIREBASE_EMAIL",
        message: "Firebase account has no verified email.",
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        success: false,
        reason: "missing_firebase_email",
        firebaseUid,
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(400).json(error);
    }

    // ── 3. Extract & validate officerId from request body ────────────────────
    const { officerId: rawOfficerId } = req.body as LoginRequest;
    if (!rawOfficerId || typeof rawOfficerId !== "string") {
      const error: LoginErrorResponse = {
        success: false,
        code: "MISSING_OFFICER_ID",
        message: "Officer ID is required.",
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        success: false,
        reason: "missing_officer_id",
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(400).json(error);
    }

    const officerId = normalizeOfficerId(rawOfficerId);

    // ── 4. READ officer from MongoDB (ZERO writes) ───────────────────────────
    const db = getDb();
    const officersCollection = db.collection<OfficerDocument>("officers");

    // ✅ READ-ONLY: findOne, no updates, no inserts
    const officer = await officersCollection.findOne({ officerId });

    if (!officer) {
      const error: LoginErrorResponse = {
        success: false,
        code: "OFFICER_NOT_FOUND",
        message: "Officer ID not found.",
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        officerId,
        success: false,
        reason: "officer_not_found",
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(404).json(error);
    }

    // ── 5. Validate email match (prevent account takeover) ───────────────────
    const dbEmail = officer.email.toLowerCase();
    if (dbEmail !== firebaseEmail) {
      const error: LoginErrorResponse = {
        success: false,
        code: "EMAIL_MISMATCH",
        message: "Email does not match officer record.",
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        officerId,
        firebaseUid,
        success: false,
        reason: "email_mismatch",
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(403).json(error);
    }

    // ── 6. Validate account status (CRITICAL: only "approved" can login) ─────
    if (officer.status !== "approved") {
      const statusCode = officer.status === "pending" ? "ACCOUNT_PENDING" : "ACCOUNT_REJECTED";
      const statusMessage =
        officer.status === "pending"
          ? "Account pending approval by administrator."
          : "Account access has been denied by administrator.";

      const error: LoginErrorResponse = {
        success: false,
        code: statusCode,
        message: statusMessage,
      };
      logAudit({
        event: "login_attempt",
        requestId,
        ip: clientIp,
        officerId,
        firebaseUid,
        success: false,
        reason: `account_${officer.status}`,
        duration: Date.now() - startTime,
      }).catch(() => {});
      return res.status(403).json(error);
    }

    // ── 7. Generate BlowSafe JWT (5-minute expiry) ───────────────────────────
    const jwtPayload = {
      uid: firebaseUid,
      email: firebaseEmail,
      officerId: officer.officerId,
      role: officer.role,
      status: officer.status,
      email_verified: decoded.email_verified || false,
    };

    const blowSafeToken = jwt.sign(jwtPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN || "5m",
      issuer: "blowsafe-backend",
      audience: "blowsafe-frontend",
    });

    // ── 8. Determine session type based on role ──────────────────────────────
    // • Officers: HTTP-only session (JWT in Authorization header)
    // • Admins/Superadmins: WebSocket session persistence (JWT for API auth only)
    const sessionType = STRICT_ROLES.has(officer.role) ? "websocket" : "http";

    // ── 9. Prepare success response ──────────────────────────────────────────
    const successResponse: LoginSuccessResponse = {
      token: blowSafeToken,
      uid: firebaseUid,
      email: firebaseEmail,
      officerId: officer.officerId,
      role: officer.role,
      status: officer.status,
      sessionType, // 🔐 Frontend uses this to decide WebSocket vs HTTP-only
    };

    // ── 10. Log successful login with role differentiation ───────────────────
    logAudit({
      event: "login_success",
      requestId,
      ip: clientIp,
      officerId: officer.officerId,
      firebaseUid,
      role: officer.role,
      sessionType, // 🔐 Audit trail includes session method
      duration: Date.now() - startTime,
    }).catch(() => {});

    // 🔐 Log admin/superadmin logins separately for security monitoring
    if (STRICT_ROLES.has(officer.role)) {
      console.log(`🔐 [${new Date().toISOString()}] ADMIN LOGIN | Officer: ${officerId} | IP: ${clientIp} | Session: WebSocket`);
    }

    // ── 11. Return response ──────────────────────────────────────────────────
    return res.status(200).json(successResponse);

  } catch (error: any) {
    // ── Unhandled error: log + return safe generic response ─────────────────
    console.error("❌ Unhandled login error:", {
      message: error.message,
      stack: env.NODE_ENV === "development" ? error.stack : undefined,
      requestId,
    });

    logAudit({
      event: "login_error",
      requestId,
      ip: clientIp,
      success: false,
      reason: "unhandled_error",
      error: error.message,
      duration: Date.now() - startTime,
    }).catch(() => {});

    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: env.NODE_ENV === "production" ? "An unexpected error occurred." : error.message,
    } as LoginErrorResponse);
  }
});

export default router;