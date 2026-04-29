/**
 * src/routes/auth.ts
 *
 * Authentication endpoints for BlowSafe.
 *
 * POST /api/auth/register  — Firebase-authed officer self-registration
 * POST /api/auth/login     — Firebase-authed officer login → JWT pair
 * POST /api/auth/refresh   — Refresh JWT using a refresh token
 * POST /api/auth/verify    — Validate a JWT (used by the mobile session guard)
 */

import { Router, type Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { verifyFirebaseToken, verifyJWT, type AuthRequest } from "../middleware/verifyToken";
import { rateLimiter } from "../middleware/rateLimiter";
import { Officer } from "../models/Officer";
import { Errors } from "../utils/errors";
import admin from "../config/firebase";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function signAccessToken(payload: {
  uid: string;
  officerId: string;
  role: string;
  status: string;
}): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function signRefreshToken(payload: {
  uid: string;
  officerId: string;
  role: string;
  status: string;
}): string {
  return jwt.sign(
    { ...payload, type: "refresh" },
    env.JWT_SECRET,
    { expiresIn: env.REFRESH_EXPIRES_IN }
  );
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post(
  "/register",
  rateLimiter,
  verifyFirebaseToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { officerId, email } = req.body as {
        officerId?: string;
        email?: string;
      };

      // Validate required fields up-front before any DB work.
      const missing: string[] = [];
      if (!officerId?.trim()) missing.push("officerId");
      if (!email?.trim()) missing.push("email");
      if (missing.length > 0) {
        Errors.missingFields(res, missing);
        return;
      }

      // All three uniqueness checks in parallel to minimise round trips.
      const [emailDoc, idDoc, uidDoc] = await Promise.all([
        Officer.findOne({ email: email!.toLowerCase().trim() }),
        Officer.findOne({ officerId: officerId!.trim() }),
        Officer.findOne({ firebaseUid: req.uid }),
      ]);

      if (emailDoc) {
        Errors.emailTaken(res);
        return;
      }
      if (idDoc) {
        Errors.officerIdTaken(res);
        return;
      }
      if (uidDoc) {
        Errors.accountAlreadyExists(res);
        return;
      }

      await Officer.create({
        officerId: officerId!.trim(),
        email: email!.toLowerCase().trim(),
        firebaseUid: req.uid,
        role: "officer",
        status: "approved", // New registrations default to approved (adjust if needed)
      });

      res.status(201).json({ message: "Officer registered successfully." });
    } catch (err) {
      Errors.internal(res, "POST /register", err);
    }
  }
);

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post(
  "/login",
  rateLimiter,
  verifyFirebaseToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { officerId } = req.body as { officerId?: string };

      if (!officerId?.trim()) {
        Errors.missingFields(res, ["officerId"]);
        return;
      }

      // Confirm the Firebase user has verified their email.
      let firebaseUser: admin.auth.UserRecord;
      try {
        firebaseUser = await admin.auth().getUser(req.uid!);
      } catch (err) {
        Errors.internal(res, "POST /login — getUser", err);
        return;
      }

      if (!firebaseUser.emailVerified) {
        Errors.emailNotVerified(res);
        return;
      }

      // Look up or auto-create the MongoDB record.
      let officer = await Officer.findOne({ firebaseUid: req.uid });

      if (officer) {
        // Existing account — make sure the submitted Officer ID matches.
        if (officer.officerId !== officerId.trim()) {
          Errors.officerIdMismatch(res);
          return;
        }
      } else {
        // First login after registration — create MongoDB record now.
        officer = await Officer.create({
          officerId: officerId.trim(),
          email: firebaseUser.email?.toLowerCase().trim(),
          firebaseUid: req.uid,
          role: "officer",
          status: "approved",
        });
      }

      // ✅ NEW: Check status — REJECTED = BANNED
      if (officer.status === "rejected") {
        Errors.forbidden(res, "Account banned. Contact admin.");
        return;
      }

      // ✅ NEW: Check if pending approval (optional, adjust based on your workflow)
      if (officer.status !== "approved") {
        Errors.forbidden(res, "Account pending approval. Contact admin.");
        return;
      }

      const tokenPayload = {
        uid: req.uid!,
        officerId: officer.officerId,
        role: officer.role,
        status: officer.status,
      };

      const token = signAccessToken(tokenPayload);
      const refreshToken = signRefreshToken(tokenPayload);

      res.status(200).json({
        token,
        refreshToken,
        role: officer.role,
        status: officer.status,
        uid: req.uid,
        officerId: officer.officerId,
      });
    } catch (err) {
      Errors.internal(res, "POST /login", err);
    }
  }
);

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────

router.post(
  "/refresh",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };

      if (!refreshToken?.trim()) {
        Errors.noToken(res);
        return;
      }

      let decoded: {
        uid: string;
        officerId: string;
        role: string;
        status: string;
        type: string;
      };

      try {
        decoded = jwt.verify(refreshToken, env.JWT_SECRET) as typeof decoded;
      } catch {
        Errors.invalidRefreshToken(res);
        return;
      }

      if (decoded.type !== "refresh") {
        Errors.invalidRefreshToken(res);
        return;
      }

      // Always re-fetch from DB so the new token carries the latest role/status.
      const officer = await Officer.findOne({ firebaseUid: decoded.uid });
      if (!officer) {
        Errors.officerNotFound(res);
        return;
      }

      // ✅ Re-check status on refresh (in case admin banned user while token was valid)
      if (officer.status === "rejected") {
        Errors.forbidden(res, "Account banned. Contact admin.");
        return;
      }
      if (officer.status !== "approved") {
        Errors.forbidden(res, "Account pending approval. Contact admin.");
        return;
      }

      const newToken = signAccessToken({
        uid: decoded.uid,
        officerId: officer.officerId,
        role: officer.role,
        status: officer.status,
      });

      res.status(200).json({
        token: newToken,
        role: officer.role,
        status: officer.status,
        officerId: officer.officerId,
      });
    } catch (err) {
      Errors.internal(res, "POST /refresh", err);
    }
  }
);

// ─── POST /api/auth/verify ───────────────────────────────────────────────────

router.post(
  "/verify",
  verifyJWT,
  (req: AuthRequest, res: Response): void => {
    res.status(200).json({
      valid: true,
      uid: req.uid,
      officerId: req.officerId,
      role: req.role,
      status: req.status, // ✅ Include status for frontend checks
    });
  }
);

// ✅ CRITICAL: Default export for Bun/ESM compatibility
export default router;