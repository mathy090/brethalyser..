// blowsafe-backend/src/routes/register.ts
import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";
import { Errors } from "../utils/errors"; // ← Use your existing error utility

const router = Router();

// Pure validation helper (no external deps)
const validateRegistration = (body: any) => {
  const errors: string[] = [];
  const { officerId, email, password } = body;

  if (!officerId || !/^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i.test(officerId)) {
    errors.push("Invalid Officer ID format (e.g., A123456B)");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Invalid email address");
  }
  if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/[!@#$%^&*]/.test(password)) {
    errors.push("Password must be 8+ chars, 1 uppercase, 1 special character");
  }

  return errors;
};

/**
 * POST /api/auth/register
 * Public route: Creates Firebase user + MongoDB officer (status: pending)
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Validate input
    const validationErrors = validateRegistration(req.body);
    if (validationErrors.length > 0) {
      Errors.invalidField(res, "registration", validationErrors[0]);
      return;
    }

    const { officerId, email, password } = req.body;

    // 2. Check for duplicates in MongoDB
    const existing = await Officer.findOne({ $or: [{ email }, { officerId }] });
    if (existing) {
      const field = existing.email === email ? "email" : "officerId";
      Errors.conflict(res, `${field.charAt(0).toUpperCase() + field.slice(1)} already registered.`);
      return;
    }

    // 3. Create Firebase Auth user (Admin SDK)
    const firebaseUser = await adminAuth.createUser({
      email,
      password,
      emailVerified: false,
      disabled: false,
    });

    // 4. Create MongoDB officer record (status: pending)
    await Officer.create({
      firebaseUid: firebaseUser.uid,
      officerId,
      email: email.toLowerCase(),
      role: "officer",        // ← Hardcoded: no privilege escalation
      status: "pending",      // ← DEFAULT: awaits admin approval
      createdAt: new Date(),
      approvalRequestedAt: new Date(),
    });

    // 5. Trigger Firebase email verification link
    await adminAuth.generateEmailVerificationLink(email);

    // 6. Respond (minimal, safe data)
    res.status(201).json({
      success: true,
      message: "✅ Account created. Check your email (including spam folder) to verify. Your account is pending admin approval (24-48 hours).",
      officerId,
      email: email.toLowerCase(),
    });

  } catch (error: any) {
    // Firebase Admin errors
    if (error.code === "auth/email-already-exists") {
      Errors.conflict(res, "Email already registered in Firebase.");
      return;
    }
    if (error.code === "auth/invalid-email") {
      Errors.invalidField(res, "email", "Invalid email address.");
      return;
    }
    if (error.code === "auth/weak-password") {
      Errors.invalidField(res, "password", "Password is too weak.");
      return;
    }

    // Catch-all
    console.error("❌ Registration error:", error);
    Errors.internal(res, "POST /api/auth/register", error);
  }
});

// ✅ CRITICAL: Default export for Bun/ESM compatibility
export default router;