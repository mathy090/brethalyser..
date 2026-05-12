// src/middleware/verifyToken.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getDb } from "../config/mongo";
import { env } from "../config/env";

export async function verifyAccessToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ code: "MISSING_TOKEN", message: "Access token required" });
    return;
  }

  const token = authHeader.split("Bearer ")[1].trim();

  try {
    // 1️⃣ Verify JWT signature + expiry
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: "blowsafe-backend",
      audience: "blowsafe-frontend",
    }) as { uid: string; officerId: string; role: string };

    // 2️⃣ Check denylist (is this token explicitly revoked?)
    const db = getDb();
    const revoked = await db.collection("token_denylist").findOne({
      token,
      expiresAt: { $gt: new Date() }, // Only check non-expired denylist entries
    });

    if (revoked) {
      res.status(401).json({ 
        code: "TOKEN_REVOKED", 
        message: "Session has been revoked. Please sign in again." 
      });
      return;
    }

    // 3️⃣ Attach user to request for downstream handlers
    req.user = payload;
    next();

  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({ code: "TOKEN_EXPIRED", message: "Access token expired" });
    } else if (err.name === "JsonWebTokenError") {
      res.status(401).json({ code: "INVALID_TOKEN", message: "Invalid access token" });
    } else {
      console.error("[Token Verification Error]", err);
      res.status(500).json({ code: "INTERNAL_ERROR", message: "Token verification failed" });
    }
  }
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        officerId: string;
        role: string;
        email?: string;
        status?: string;
      };
    }
  }
}