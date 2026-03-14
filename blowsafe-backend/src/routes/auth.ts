import { Router, type Response } from "express";
import jwt from "jsonwebtoken";
import { verifyFirebaseToken, verifyJWT, type AuthRequest } from "../middleware/verifyToken";
import { rateLimiter } from "../middleware/rateLimiter";
import { Officer } from "../models/Officer";
import admin from "../config/firebase";

const router = Router();

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

router.post("/login", rateLimiter, verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { officerId } = req.body;

    // Step 1 — Firebase Admin gets full user info
    const firebaseUser = await admin.auth().getUser(req.uid!);

    // Step 2 — Check email verified
    if (!firebaseUser.emailVerified) {
      res.status(403).json({ message: "Email not verified. Check your inbox." });
      return;
    }

    // Step 3 — Find officer in MongoDB by firebaseUid
    let officer = await Officer.findOne({ firebaseUid: req.uid });

    if (officer) {
      // Officer exists — use their existing role and status
      // Just update officerId in case it changed
      if (officer.officerId !== officerId) {
        officer = await Officer.findOneAndUpdate(
          { firebaseUid: req.uid },
          { officerId },
          { new: true }
        ) ?? officer;
      }
    } else {
      // Officer not found — create new with default role
      officer = await Officer.create({
        officerId,
        email: firebaseUser.email,
        firebaseUid: req.uid,
        role: "officer",
        status: "approved",
      });
    }

    // Step 4 — Issue JWT with role from MongoDB
    const token = jwt.sign(
      {
        uid: req.uid,
        officerId: officer.officerId,
        role: officer.role,
        status: officer.status,
      },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
    );

    const refreshToken = jwt.sign(
      {
        uid: req.uid,
        officerId: officer.officerId,
        role: officer.role,
        status: officer.status,
        type: "refresh",
      },
      process.env.JWT_SECRET!,
      { expiresIn: "30d" }
    );

    // Step 5 — Return token + role to frontend
    res.status(200).json({
      token,
      refreshToken,
      role: officer.role,
      status: officer.status,
      uid: req.uid,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

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
      role: string;
      status: string;
      type: string;
    };

    if (decoded.type !== "refresh") {
      res.status(401).json({ message: "Invalid token type" });
      return;
    }

    // Always fetch latest role from MongoDB
    const officer = await Officer.findOne({ firebaseUid: decoded.uid });
    if (!officer) {
      res.status(403).json({ message: "Officer not found" });
      return;
    }

    const newToken = jwt.sign(
      {
        uid: decoded.uid,
        officerId: officer.officerId,
        role: officer.role,
        status: officer.status,
      },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
    );

    res.status(200).json({
      token: newToken,
      role: officer.role,
      status: officer.status,
    });
  } catch {
    res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});

router.post("/verify", verifyJWT, (req: AuthRequest, res: Response): void => {
  res.status(200).json({
    valid: true,
    uid: req.uid,
    officerId: req.officerId,
    role: req.role,
  });
});

export default router;