import { Router, type Request, type Response } from "express";
import admin from "../config/firebase";
import jwt from "jsonwebtoken";
import { verifyFirebaseToken, type AuthRequest } from "../middleware/verifyToken";

const router = Router();

/**
 * POST /api/auth/login
 *
 * Flow:
 * 1. Client sends Firebase ID token
 * 2. We verify it with Firebase Admin SDK
 * 3. We issue our own signed JWT back
 * 4. MongoDB officer lookup comes later — verification first
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
 * Lightweight endpoint to check if a JWT is still valid
 * Used on app startup to decide if user can skip login
 */
router.post("/verify", (req: Request, res: Response): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ valid: false });
    return;
  }

  try {
    const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET!);
    res.status(200).json({ valid: true, decoded });
  } catch {
    res.status(401).json({ valid: false });
  }
});

export default router;