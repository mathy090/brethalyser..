/**
 * src/auth/login.ts
 *
 * Simple Login Flow with Refresh Tokens:
 * 1. Verify Firebase ID token
 * 2. Read officer from MongoDB (READ-ONLY)
 * 3. If approved → issue:
 *    • Short-lived access token (JWT, 5 min)
 *    • Long-lived refresh token (JWT, 7 days, stored in httpOnly cookie)
 * 4. Return access token + user metadata to frontend
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
  accessToken: string; // Short-lived, for API calls
  user: {
    uid: string;
    email: string;
    officerId: string;
    role: OfficerDocument["role"];
    status: OfficerDocument["status"];
  };
}

interface LoginErrorResponse {
  success: false;
  code: string;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const normalizeOfficerId = (id: string): string => id.trim().toUpperCase();

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.headers["x-request-id"] || Math.random().toString(36).slice(2);
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || "unknown";

  try {
    // ── 1. Extract Firebase ID token ───────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "MISSING_TOKEN",
        message: "Missing Firebase ID token.",
      } as LoginErrorResponse);
    }

    const idToken = authHeader.split("Bearer ")[1].trim();

    // ── 2. Verify with Firebase ────────────────────────────────────────────
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err: any) {
      const isAuthError = err.code?.startsWith("auth/");
      return res.status(401).json({
        success: false,
        code: isAuthError ? "INVALID_TOKEN" : "TOKEN_VERIFICATION_FAILED",
        message: isAuthError ? "Invalid Firebase token." : "Token verification failed.",
      } as LoginErrorResponse);
    }

    const firebaseUid = decoded.uid;
    const firebaseEmail = decoded.email?.toLowerCase();
    if (!firebaseEmail) {
      return res.status(400).json({
        success: false,
        code: "MISSING_EMAIL",
        message: "Firebase account has no verified email.",
      } as LoginErrorResponse);
    }

    // ── 3. Extract & validate officerId ────────────────────────────────────
    const { officerId: rawOfficerId } = req.body as LoginRequest;
    if (!rawOfficerId || typeof rawOfficerId !== "string") {
      return res.status(400).json({
        success: false,
        code: "MISSING_OFFICER_ID",
        message: "Officer ID is required.",
      } as LoginErrorResponse);
    }
    const officerId = normalizeOfficerId(rawOfficerId);

    // ── 4. READ officer from MongoDB ───────────────────────────────────────
    const db = getDb();
    const officer = await db.collection<OfficerDocument>("officers").findOne({ officerId });

    if (!officer) {
      return res.status(404).json({
        success: false,
        code: "OFFICER_NOT_FOUND",
        message: "Officer ID not found.",
      } as LoginErrorResponse);
    }

    // ── 5. Validate email match ────────────────────────────────────────────
    if (officer.email.toLowerCase() !== firebaseEmail) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_MISMATCH",
        message: "Email does not match officer record.",
      } as LoginErrorResponse);
    }

    // ── 6. Validate account status ─────────────────────────────────────────
    if (officer.status !== "approved") {
      const code = officer.status === "pending" ? "ACCOUNT_PENDING" : "ACCOUNT_REJECTED";
      const message =
        officer.status === "pending"
          ? "Account pending administrator approval."
          : "Account access has been denied.";
      return res.status(403).json({
        success: false,
        code,
        message,
      } as LoginErrorResponse);
    }

    // ── 7. Generate tokens ─────────────────────────────────────────────────
    const userPayload = {
      uid: firebaseUid,
      email: firebaseEmail,
      officerId: officer.officerId,
      role: officer.role,
      status: officer.status,
    };

    // 🔑 Access token: short-lived, for API calls
    const accessToken = jwt.sign(userPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN || "5m",
      issuer: "blowsafe-backend",
      audience: "blowsafe-frontend",
    });

    // 🔑 Refresh token: long-lived, for getting new access tokens
    const refreshToken = jwt.sign(
      { uid: firebaseUid, type: "refresh" }, // Minimal payload
      env.JWT_SECRET,
      {
        expiresIn: env.REFRESH_EXPIRES_IN || "7d",
        issuer: "blowsafe-backend",
        audience: "blowsafe-frontend",
      }
    );

    // ── 8. Set refresh token in httpOnly cookie ────────────────────────────
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,        // ❌ JavaScript cannot read this cookie
      secure: env.NODE_ENV === "production", // ✅ Only send over HTTPS in prod
      sameSite: "strict",    // ✅ Prevent CSRF
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/api/auth/refresh", // Only send to refresh endpoint
    });

    // ── 9. Prepare response (NO refresh token in body!) ────────────────────
    const response: LoginSuccessResponse = {
      accessToken,
      user: {
        uid: firebaseUid,
        email: firebaseEmail,
        officerId: officer.officerId,
        role: officer.role,
        status: officer.status,
      },
    };

    // ── 10. Fire-and-forget audit log ──────────────────────────────────────
    logAudit({
      event: "login_success",
      requestId,
      ip: clientIp,
      officerId: officer.officerId,
      firebaseUid,
      role: officer.role,
      duration: Date.now() - startTime,
    }).catch(() => {});

    return res.status(200).json(response);

  } catch (error: any) {
    console.error("[Login Error]", {
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