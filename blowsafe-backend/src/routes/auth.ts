import { Router, type Response } from "express";
import admin from "../config/firebase";
import jwt from "jsonwebtoken";
import { verifyFirebaseToken, verifyJWT, type AuthRequest } from "../middleware/verifyToken";

const router = Router();

/**
 * POST /api/auth/login
 * 1. Firebase Admin SDK verifies the ID token
 * 2. We issue our own JWT and store it
 * 3. Frontend stores it in Keychain
 * 4. Every future request compares Bearer JWT against JWT_SECRET
 */
router.post("/login", verifyFirebaseToken, (req: AuthRequest, res: Response): void => {
  try {
    const token = jwt.sign(
      {
        uid: req.uid,
        officerId: req.body.officerId ?? null,
      },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
    );

    res.status(200).json({
      message: "Verified",
      token,
      uid: req.uid,
    });
  } catch {
    res.status(500).json({ message: "Token signing failed" });
  }
});

/**
 * POST /api/auth/verify
 * Frontend sends its cached JWT
 * Backend checks it against JWT_SECRET
 * If valid — session restored, no re-login needed
 * If invalid/expired — frontend clears cache and sends to login
 */
router.post("/verify", verifyJWT, (req: AuthRequest, res: Response): void => {
  res.status(200).json({
    valid: true,
    uid: req.uid,
    officerId: req.officerId,
  });
});

export default router;