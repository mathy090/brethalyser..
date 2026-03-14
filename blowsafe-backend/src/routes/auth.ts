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
      res.status(400).json({ message: "Officer ID and email are required." });
      return;
    }

    // Check if this email already has an account
    const emailExists = await Officer.findOne({ email });
    if (emailExists) {
      res.status(409).json({ message: "This email is already registered. Use a different email." });
      return;
    }

    // Check if this officerId is already taken by another email
    const idExists = await Officer.findOne({ officerId });
    if (idExists) {
      res.status(409).json({ message: "This Officer ID is already taken. Please enter your correct ID." });
      return;
    }

    // Check if this Firebase account already registered
    const uidExists = await Officer.findOne({ firebaseUid: req.uid });
    if (uidExists) {
      res.status(409).json({ message: "This account is already registered." });
      return;
    }

    await Officer.create({
      officerId,
      email,
      firebaseUid: req.uid,
      role: "officer",
      status: "approved",
    });

    res.status(201).json({ message: "Officer registered successfully." });
  } catch {
    res.status(500).json({ message: "Registration failed. Try again." });
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

    // Find officer by firebaseUid
    let officer = await Officer.findOne({ firebaseUid: req.uid });

    if (officer) {
      // Officer found — verify officerId matches
      if (officer.officerId !== officerId) {
        res.status(403).json({ message: "Officer ID does not match this account." });
        return;
      }
    } else {
      // Not found — create with default role
      officer = await Officer.create({
        officerId,
        email: firebaseUser.email,
        firebaseUid: req.uid,
        role: "officer",
        status: "approved",
      });
    }

    // Issue JWT with role from MongoDB
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

    res.status(200).json({
      token,
      refreshToken,
      role: officer.role,
      status: officer.status,
      uid: req.uid,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed. Try again." });
  }
});

// POST /api/auth/refresh
router.post("/refresh", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(401).json({ message: "No refresh token." });
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
      res.status(401).json({ message: "Invalid token type." });
      return;
    }

    // Always fetch latest role from MongoDB
    const officer = await Officer.findOne({ firebaseUid: decoded.uid });
    if (!officer) {
      res.status(403).json({ message: "Officer not found." });
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
    res.status(401).json({ message: "Invalid or expired refresh token." });
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