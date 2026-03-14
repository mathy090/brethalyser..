import type { Request, Response, NextFunction } from "express";
import admin from "../config/firebase";
import jwt from "jsonwebtoken";

/**
 * Two-layer verification:
 * 1. Accepts Firebase ID token  → verifies with Firebase Admin SDK
 * 2. Accepts your own JWT       → verifies with JWT_SECRET
 *
 * Attach whichever token your client sends in Authorization header:
 * "Bearer <token>"
 */

export interface AuthRequest extends Request {
  uid?: string;       // Firebase UID
  officerId?: string; // from your JWT payload
}

// ── Layer 1: Verify Firebase ID token ────────────────────────────────
export const verifyFirebaseToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ message: "No token provided" });
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired Firebase token" });
  }
};

// ── Layer 2: Verify your own JWT ──────────────────────────────────────
export const verifyJWT = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ message: "No token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      uid: string;
      officerId: string;
    };
    req.uid = decoded.uid;
    req.officerId = decoded.officerId;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

// ── Helper ────────────────────────────────────────────────────────────
const extractBearer = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.split(" ")[1];
};