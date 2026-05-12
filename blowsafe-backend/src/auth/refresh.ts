/**
 * src/auth/refresh.ts
 *
 * Refresh Token Endpoint:
 * - Reads httpOnly refreshToken cookie
 * - Verifies token signature + expiry
 * - Looks up user in MongoDB to ensure still approved
 * - Issues NEW access token (refresh token stays the same)
 * - Optional: rotate refresh token for extra security
 */

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { getDb } from "../config/mongo";
import { logAudit } from "../utils/auditLogger";

const router = Router();

interface RefreshErrorResponse {
  success: false;
  code: string;
  message: string;
}

interface RefreshSuccessResponse {
  accessToken: string;
}

router.post("/", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.headers["x-request-id"] || Math.random().toString(36).slice(2);
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || "unknown";

  try {
    // ── 1. Extract refresh token from httpOnly cookie ──────────────────────
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        code: "MISSING_REFRESH_TOKEN",
        message: "Refresh token required.",
      } as RefreshErrorResponse);
    }

    // ── 2. Verify refresh token ────────────────────────────────────────────
    let decoded: { uid: string; type: string; iat: number; exp: number };
    try {
      decoded = jwt.verify(refreshToken, env.JWT_SECRET, {
        issuer: "blowsafe-backend",
        audience: "blowsafe-frontend",
      }) as any;
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: "INVALID_REFRESH_TOKEN",
        message: "Invalid or expired refresh token.",
      } as RefreshErrorResponse);
    }

    if (decoded.type !== "refresh") {
      return res.status(401).json({
        success: false,
        code: "INVALID_TOKEN_TYPE",
        message: "Token type mismatch.",
      } as RefreshErrorResponse);
    }

    const firebaseUid = decoded.uid;

    // ── 3. Lookup officer in MongoDB (ensure still approved) ───────────────
    const db = getDb();
    const officer = await db
      .collection("officers")
      .findOne({ firebaseUid }, { projection: { officerId: 1, email: 1, role: 1, status: 1 } });

    if (!officer || officer.status !== "approved") {
      // Clear invalid cookie
      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh",
      });

      return res.status(403).json({
        success: false,
        code: officer ? "ACCOUNT_NOT_APPROVED" : "USER_NOT_FOUND",
        message: officer?.status === "pending"
          ? "Account pending approval."
          : "Account access denied or not found.",
      } as RefreshErrorResponse);
    }

    // ── 4. Generate NEW access token ───────────────────────────────────────
    const accessToken = jwt.sign(
      {
        uid: officer.firebaseUid,
        email: officer.email,
        officerId: officer.officerId,
        role: officer.role,
        status: officer.status,
      },
      env.JWT_SECRET,
      {
        expiresIn: env.JWT_EXPIRES_IN || "5m",
        issuer: "blowsafe-backend",
        audience: "blowsafe-frontend",
      }
    );

    // ── 5. Optional: Rotate refresh token (extra security) ─────────────────
    // Uncomment to enable rotation (invalidates old refresh token):
    /*
    const newRefreshToken = jwt.sign(
      { uid: firebaseUid, type: "refresh" },
      env.JWT_SECRET,
      { expiresIn: env.REFRESH_EXPIRES_IN || "7d" }
    );
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth/refresh",
    });
    */

    // ── 6. Log success (fire-and-forget) ───────────────────────────────────
    logAudit({
      event: "token_refresh",
      requestId,
      ip: clientIp,
      officerId: officer.officerId,
      firebaseUid,
      duration: Date.now() - startTime,
    }).catch(() => {});

    // ── 7. Return new access token ─────────────────────────────────────────
    return res.status(200).json({ accessToken } as RefreshSuccessResponse);

  } catch (error: any) {
    console.error("[Refresh Error]", {
      message: error.message,
      stack: env.NODE_ENV === "development" ? error.stack : undefined,
      requestId,
    });

    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: env.NODE_ENV === "production" ? "An unexpected error occurred." : error.message,
    } as RefreshErrorResponse);
  }
});

export default router;