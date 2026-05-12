/**
 * src/auth/logout.ts
 *
 * Secure Logout Flow:
 * 1. Extract access token from Authorization header (optional, for revocation)
 * 2. Clear the httpOnly refresh token cookie
 * 3. (Optional) Add access token to short-term denylist in MongoDB
 * 4. Log the logout event for audit
 * 5. Return success response
 *
 * Why revoke access tokens?
 * • Short-lived tokens (5 min) reduce risk, but immediate revocation is better for:
 *   - Admin accounts with elevated privileges
 *   - Suspicious activity detection
 *   - Compliance requirements (audit trails)
 */

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { getDb } from "../config/mongo";
import { logAudit } from "../utils/auditLogger";

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────
interface LogoutErrorResponse {
  success: false;
  code: string;
  message: string;
}

interface LogoutSuccessResponse {
  success: true;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Extract access token from Authorization header
 * Returns null if missing or malformed
 */
function extractAccessToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.split("Bearer ")[1]?.trim();
  return token || null;
}

/**
 * Decode JWT payload without verifying signature
 * Used to get token expiry for denylist TTL
 * ⚠️ Never use decoded data for auth decisions — only for metadata
 */
function decodeTokenPayload(token: string): { exp?: number; uid?: string } | null {
  try {
    const payload = jwt.decode(token);
    if (!payload || typeof payload === "string") return null;
    return payload as { exp?: number; uid?: string };
  } catch {
    return null;
  }
}

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.headers["x-request-id"] || Math.random().toString(36).slice(2);
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || "unknown";

  try {
    // ── 1. Extract access token (optional, for revocation) ───────────────────
    const accessToken = extractAccessToken(req.headers.authorization);
    let tokenPayload: { exp?: number; uid?: string } | null = null;
    let firebaseUid: string | null = null;

    if (accessToken) {
      tokenPayload = decodeTokenPayload(accessToken);
      firebaseUid = tokenPayload?.uid || null;
    }

    // ── 2. Clear the httpOnly refresh token cookie ───────────────────────────
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: env.NODE_ENV === "production", // ✅ Only send over HTTPS in prod
      sameSite: "strict",                    // ✅ Prevent CSRF
      path: "/api/auth/refresh",             // ✅ Must match the cookie's original path
    });

    // ── 3. (Optional) Add access token to denylist for immediate revocation ─
    // This prevents the short-lived access token from being used after logout
    if (accessToken && tokenPayload?.exp) {
      const db = getDb();
      const denylistCollection = db.collection("token_denylist");

      // Calculate TTL: time until token naturally expires + 1 min buffer
      const now = Date.now() / 1000; // JWT exp is in seconds
      const ttlSeconds = Math.max(0, Math.ceil(tokenPayload.exp - now)) + 60;

      // Insert with MongoDB TTL index (auto-delete after expiry)
      await denylistCollection.insertOne(
        {
          token: accessToken, // Store full token for exact match
          uid: firebaseUid,
          reason: "logout",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        },
        {
          // Optional: ignore duplicate if already revoked
          ignoreDuplicates: true,
        }
      );

      // Ensure TTL index exists (run once at startup, or use MongoDB Atlas auto-TTL)
      // await denylistCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    }

    // ── 4. Log the logout event (fire-and-forget) ────────────────────────────
    logAudit({
      event: "logout",
      requestId,
      ip: clientIp,
      firebaseUid,
      tokenRevoked: !!accessToken,
      duration: Date.now() - startTime,
    }).catch(() => {}); // Ignore log errors — don't fail the logout

    // ── 5. Return success response ───────────────────────────────────────────
    const response: LogoutSuccessResponse = {
      success: true,
      message: "Logged out successfully",
    };

    return res.status(200).json(response);

  } catch (error: any) {
    // Unhandled error: log + safe generic response
    console.error("[Logout Error]", {
      message: error.message,
      stack: env.NODE_ENV === "development" ? error.stack : undefined,
      requestId,
    });

    // Still clear the cookie even if denylist insert fails
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/refresh",
    });

    logAudit({
      event: "logout_error",
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
    } as LogoutErrorResponse);
  }
});

export default router;