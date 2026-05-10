/**
 * src/routes/register.ts
 *
 * Registration flow (backend side):
 *
 * Step 1 — POST /api/auth/register/check
 *   Validates Officer ID + email uniqueness in MongoDB.
 *   Returns a short-lived signed token if the slot is free.
 *   Frontend uses this token to confirm the backend approved the check.
 *
 * Step 2 — POST /api/auth/register/complete
 *   Called by the frontend AFTER it has created the Firebase account
 *   and sent the verification email via the Firebase Web SDK.
 *   Verifies the check token, then creates the MongoDB officer record.
 *
 * Why this split?
 *   - No Firebase Admin SDK calls needed for account creation.
 *   - The Firebase Web SDK on the frontend handles createUserWithEmailAndPassword
 *     and sendEmailVerification natively.
 *   - The backend still owns the uniqueness gate and the DB record.
 */

import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";

import { env }     from "../config/env";
import { Officer } from "../models/Officer";
import { Errors }  from "../utils/errors";

const router = Router();

// ─── Validation helpers ───────────────────────────────────────────────────────

const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;

function validateBody(officerId?: string, email?: string) {
  const missing: string[] = [];
  if (!officerId?.trim()) missing.push("officerId");
  if (!email?.trim())     missing.push("email");
  return missing;
}

// ─── POST /api/auth/register/check ───────────────────────────────────────────
//
// Checks that the Officer ID and email are not already taken in MongoDB.
// On success returns a short-lived JWT that the frontend must present in /complete.

router.post(
  "/check",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { officerId, email } = req.body as {
        officerId?: string;
        email?:    string;
      };

      // 1. Presence validation
      const missing = validateBody(officerId, email);
      if (missing.length > 0) {
        Errors.missingFields(res, missing);
        return;
      }

      const normId    = officerId!.trim().toUpperCase();
      const normEmail = email!.trim().toLowerCase();

      // 2. Format validation
      if (!OFFICER_ID_RE.test(normId)) {
        Errors.invalidField(
          res,
          "officerId",
          "must be in format A123456B or 9 numeric digits"
        );
        return;
      }

      // 3. Uniqueness checks (parallel)
      const [emailDoc, idDoc] = await Promise.all([
        Officer.findOne({ email:     normEmail }),
        Officer.findOne({ officerId: normId    }),
      ]);

      if (emailDoc) { Errors.emailTaken(res);     return; }
      if (idDoc)    { Errors.officerIdTaken(res); return; }

      // 4. Issue a short-lived check token (5 min)
      //    The frontend presents this to /complete so we know the check passed.
      const checkToken = jwt.sign(
        { officerId: normId, email: normEmail, purpose: "register_check" },
        env.JWT_SECRET,
        { expiresIn: "5m" }
      );

      res.status(200).json({
        ok:         true,
        checkToken,
        message:    "Officer ID and email are available. Proceed with account creation.",
      });
    } catch (err) {
      Errors.internal(res, "POST /register/check", err);
    }
  }
);

// ─── POST /api/auth/register/complete ────────────────────────────────────────
//
// Called after the Firebase Web SDK has created the user and sent the
// verification email. We verify the check token, then save to MongoDB.

router.post(
  "/complete",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { checkToken, firebaseUid } = req.body as {
        checkToken?:  string;
        firebaseUid?: string;
      };

      // 1. Basic presence
      if (!checkToken?.trim()) {
        Errors.noToken(res);
        return;
      }
      if (!firebaseUid?.trim()) {
        Errors.missingFields(res, ["firebaseUid"]);
        return;
      }

      // 2. Verify check token
      let decoded: { officerId: string; email: string; purpose: string };
      try {
        decoded = jwt.verify(checkToken, env.JWT_SECRET) as typeof decoded;
      } catch {
        Errors.invalidToken(res);
        return;
      }

      if (decoded.purpose !== "register_check") {
        Errors.invalidToken(res);
        return;
      }

      const { officerId, email } = decoded;

      // 3. Guard against replay / race condition — check again
      const [emailDoc, idDoc, uidDoc] = await Promise.all([
        Officer.findOne({ email }),
        Officer.findOne({ officerId }),
        Officer.findOne({ firebaseUid }),
      ]);

      if (emailDoc)  { Errors.emailTaken(res);         return; }
      if (idDoc)     { Errors.officerIdTaken(res);     return; }
      if (uidDoc)    { Errors.accountAlreadyExists(res); return; }

      // 4. Create MongoDB record (status pending — admin must approve)
      await Officer.create({
        officerId,
        email,
        firebaseUid,
        role:   "officer",
        status: "pending",
      });

      res.status(201).json({
        ok:      true,
        message: "Officer account created. Verify your email then wait for admin approval.",
      });
    } catch (err) {
      Errors.internal(res, "POST /register/complete", err);
    }
  }
);

export default router;