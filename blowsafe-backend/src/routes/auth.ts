import { Router, type Response } from "express";
import jwt from "jsonwebtoken";
import { verifyFirebaseToken, verifyJWT, type AuthRequest } from "../middleware/verifyToken";
import { rateLimiter } from "../middleware/rateLimiter";
import { Officer } from "../models/Officer";
import admin from "../config/firebase";

const router = Router();

// POST /api/auth/register
router.post("/register", rateLimiter, verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { officerId, email } = req.body;
    if (!officerId || !email) {
      res.status(400).json({ message: "officerId and email required" });
      return;
    }

    const existing = await Officer.findOne({
      $or: [{ officerId }, { email }, { firebaseUid: req.uid }],
    });
    if (existing) {
      res.status(409).json({ message: "Officer already registered" });
      return;
    }

    await Officer.create({ officerId, email, firebaseUid: req.uid });
    res.status(201).json({ message: "Officer registered" });
  } catch {
    res.status(500).json({ message: "Registration failed" });
  }
});

// POST /api/auth/login
router.post("/login", rateLimiter, verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { officerId } = req.body;

    // Check email verified
    const firebaseUser = await admin.auth().getUser(req.uid!);
    if (!firebaseUser.emailVerified) {
      res.status(403).json({ message: "Email not verified. Check your inbox." });
      return;
    }

    // Check officer exists in MongoDB
    const officer = await Officer.findOne({ officerId, firebaseUid: req.uid });
    if (!officer) {
      res.status(403).json({ message: "Officer not found. Contact your administrator." });
      return;
    }

    // JWT includes role — frontend uses this to show/hide tabs
    const token = jwt.sign(
      { uid: req.uid, officerId: officer.officerId, role: officer.role },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
    );

    const refreshToken = jwt.sign(
      { uid: req.uid, officerId: officer.officerId, role: officer.role, type: "refresh" },
      process.env.JWT_SECRET!,
      { expiresIn: "30d" }
    );

    res.status(200).json({
      token,
      refreshToken,
      role: officer.role,
      uid: req.uid,
    });
  } catch {
    res.status(500).json({ message: "Login failed" });
  }
});

// POST /api/auth/refresh — always fetch latest role from DB
router.post("/refresh", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(401).json({ message: "No refresh token" });
      return;
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET!) as {
      uid: string;
      officerId: string;
      type: string;
    };

    if (decoded.type !== "refresh") {
      res.status(401).json({ message: "Invalid token type" });
      return;
    }

    // Always fetch latest role from DB — catches promotions/demotions
    const officer = await Officer.findOne({ officerId: decoded.officerId, firebaseUid: decoded.uid });
    if (!officer) {
      res.status(403).json({ message: "Officer not found" });
      return;
    }

    const newToken = jwt.sign(
      { uid: decoded.uid, officerId: officer.officerId, role: officer.role },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
    );

    res.status(200).json({ token: newToken, role: officer.role });
  } catch {
    res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});

// POST /api/auth/verify
router.post("/verify", verifyJWT, (req: AuthRequest, res: Response): void => {
  res.status(200).json({
    valid: true,
    uid: req.uid,
    officerId: req.officerId,
    role: req.role,
  });
});

export default router;