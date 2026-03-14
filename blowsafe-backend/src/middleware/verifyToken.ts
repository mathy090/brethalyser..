import type { Request, Response, NextFunction } from "express";
import admin from "../config/firebase";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  uid?: string;
  officerId?: string;
  role?: string;
}

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
      role: string;
    };
    req.uid = decoded.uid;
    req.officerId = decoded.officerId;
    req.role = decoded.role;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

const extractBearer = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.split(" ")[1];
};