/**
 * src/middleware/verifyToken.ts
 *
 * Express middleware for token verification.
 *
 * Layer 1 — verifyFirebaseToken
 *   Validates the short-lived Firebase ID token sent immediately after Firebase
 *   authentication. Used on /register and /login only.
 *
 * Layer 2 — verifyJWT
 *   Validates the long-lived BlowSafe JWT issued by /login and /refresh.
 *   Used on every protected API endpoint.
 *
 * Layer 3 — requireRole
 *   Role-based access control guard. Must be applied after verifyJWT.
 */

import type { Request, Response, NextFunction } from "express";
import jwt                                       from "jsonwebtoken";

import { env }    from "../config/env";
import { Errors } from "../utils/errors";
import admin      from "../config/firebase";

// ─── Extended request type ───────────────────────────────────────────────────

export interface AuthRequest extends Request {
  uid?:       string;
  officerId?: string;
  role?:      string;
}

// ─── Layer 1: Firebase ID token ──────────────────────────────────────────────

export const verifyFirebaseToken = async (
  req:  AuthRequest,
  res:  Response,
  next: NextFunction
): Promise<void> => {
  const token = extractBearer(req);

  if (!token) {
    Errors.noToken(res);
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    // Firebase throws for expired, revoked, or malformed tokens — all map to 401.
    Errors.invalidToken(res);
  }
};

// ─── Layer 2: BlowSafe JWT ───────────────────────────────────────────────────

export const verifyJWT = (
  req:  AuthRequest,
  res:  Response,
  next: NextFunction
): void => {
  const token = extractBearer(req);

  if (!token) {
    Errors.noToken(res);
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      uid:       string;
      officerId: string;
      role:      string;
      status:    string;
    };

    req.uid       = decoded.uid;
    req.officerId = decoded.officerId;
    req.role      = decoded.role;
    next();
  } catch {
    // Covers TokenExpiredError, JsonWebTokenError, NotBeforeError.
    Errors.invalidToken(res);
  }
};

// ─── Layer 3: Role guard ─────────────────────────────────────────────────────

export const requireRole =
  (...roles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.role || !roles.includes(req.role)) {
      Errors.insufficientPermissions(res);
      return;
    }
    next();
  };

// ─── Helper ──────────────────────────────────────────────────────────────────

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.split(" ")[1];
  return token?.trim() || null;
}