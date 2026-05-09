import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";

const router = Router();

const validateRegistration = (body: any) => {
  const { officerId, email, password } = body;

  if (!officerId || !/^[A-Z]\d{6}[A-Z]$|^\d{9}$/i.test(officerId)) {
    return "INVALID_OFFICER_ID";
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "INVALID_EMAIL";
  }

  if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/[!@#$%^&*]/.test(password)) {
    return "WEAK_PASSWORD";
  }

  return null;
};

router.post("/", async (req: Request, res: Response) => {
  try {
    const { officerId, email, password } = req.body;

    const normalizedOfficerId = officerId?.toUpperCase().trim();
    const normalizedEmail = email?.toLowerCase().trim();

    // =========================
    // 1. VALIDATION
    // =========================
    const validationError = validateRegistration(req.body);
    if (validationError) {
      return res.status(400).json({
        success: false,
        code: validationError,
        error: validationError
      });
    }

    // =========================
    // 2. CHECK MONGODB FIRST (CRITICAL)
    // =========================
    const existingOfficer = await Officer.findOne({
      officerId: normalizedOfficerId
    });

    if (existingOfficer) {
      return res.status(409).json({
        success: false,
        code: "OFFICER_ID_EXISTS",
        error: "Officer ID already in use"
      });
    }

    // ALSO check email in Mongo
    const existingEmail = await Officer.findOne({
      email: normalizedEmail
    });

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        code: "EMAIL_EXISTS",
        error: "Email already registered"
      });
    }

    // =========================
    // 3. CREATE FIREBASE USER
    // =========================
    let firebaseUser;

    try {
      firebaseUser = await adminAuth.createUser({
        email: normalizedEmail,
        password,
        emailVerified: false,
      });
    } catch (err: any) {
      if (err.code === "auth/email-already-exists") {
        return res.status(409).json({
          success: false,
          code: "EMAIL_EXISTS",
          error: "Email already exists in Firebase"
        });
      }

      return res.status(500).json({
        success: false,
        code: "FIREBASE_ERROR",
        error: err.message
      });
    }

    // =========================
    // 4. CREATE MONGODB USER
    // =========================
    await Officer.create({
      officerId: normalizedOfficerId,
      email: normalizedEmail,
      firebaseUid: firebaseUser.uid,
      role: "officer",
      status: "pending",
      createdAt: new Date(),
    });

    // =========================
    // 5. SEND VERIFICATION LINK
    // =========================
    try {
      const link = await adminAuth.generateEmailVerificationLink(normalizedEmail);
      console.log("EMAIL LINK:", link);
    } catch (e) {
      console.warn("Email link failed:", e);
    }

    return res.status(201).json({
      success: true,
      code: "ACCOUNT_CREATED",
      message: "Account created successfully"
    });

  } catch (err: any) {
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      error: err.message
    });
  }
});

export default router;