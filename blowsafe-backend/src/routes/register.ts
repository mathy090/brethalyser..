// blowsafe-backend/src/routes/register.ts
import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";
import { Errors } from "../utils/errors";

const router = Router();

// Pure validation helper
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
 * 
 * STRICT ORDER:
 * 1. Validate input
 * 2. 🔍 Check MongoDB for officerId (CASE-INSENSITIVE) ← BEFORE ANY FIREBASE CALLS
 * 3. If exists → LOG WARNING → RETURN ERROR → STOP (no Firebase, no email)
 * 4. Only if NOT exists → Create Firebase user
 * 5. Create MongoDB record (status: pending)
 * 6. Send verification email
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
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedOfficerId = officerId.toUpperCase().trim();

    // 2. 🔍 CRITICAL: Check MongoDB for officerId FIRST (before ANY Firebase calls)
    // Case-insensitive, trimmed match
    const existingOfficer = await Officer.findOne({
      officerId: { $regex: new RegExp(`^${normalizedOfficerId}$`, 'i') }
    });

    if (existingOfficer) {
      // 🚨 SECURITY LOG: Attempted duplicate registration
      console.warn(`⚠️ REGISTRATION BLOCKED: Officer ID "${normalizedOfficerId}" already exists in MongoDB. 
        IP: ${req.ip}, 
        Email attempted: "${normalizedEmail}", 
        Existing account status: "${existingOfficer.status}", 
        Timestamp: ${new Date().toISOString()}`);
      
      // ✅ RETURN ERROR IMMEDIATELY — NO FIREBASE, NO EMAIL
      return res.status(409).json({
        success: false,
        error: "User account already in use, use your actual ID officer",
        code: "OFFICER_ID_ALREADY_EXISTS",
        field: "officerId"
      });
    }

    // 3. ✅ Officer ID is unique → Proceed to Firebase
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.createUser({
        email: normalizedEmail,
        password,
        emailVerified: false,
        disabled: false,
      });
    } catch (firebaseError: any) {
      // Handle Firebase-specific errors
      if (firebaseError.code === "auth/email-already-exists") {
        return res.status(409).json({
          success: false,
          error: "Email already registered in Firebase. Please sign in.",
          code: "FIREBASE_EMAIL_EXISTS"
        });
      }
      if (firebaseError.code === "auth/invalid-email") {
        Errors.invalidField(res, "email", "Invalid email address.");
        return;
      }
      if (firebaseError.code === "auth/weak-password") {
        Errors.invalidField(res, "password", "Password is too weak.");
        return;
      }
      throw firebaseError;
    }

    // 4. ✅ Create MongoDB officer record (status: pending)
    try {
      await Officer.create({
        firebaseUid: firebaseUser.uid,
        officerId: normalizedOfficerId,
        email: normalizedEmail,
        role: "officer",        // ← Hardcoded: no privilege escalation
        status: "pending",      // ← DEFAULT: awaits admin approval
        createdAt: new Date(),
        approvalRequestedAt: new Date(),
      });
    } catch (mongoError: any) {
      // Handle duplicate key errors (unique index violation) as final safety net
      if (mongoError.code === 11000) {
        // Clean up Firebase user to avoid orphans
        try {
          await adminAuth.deleteUser(firebaseUser.uid);
        } catch (cleanupError) {
          console.warn("⚠️ Failed to clean up Firebase user after MongoDB duplicate:", cleanupError);
        }
        
        const field = mongoError.keyPattern?.officerId ? "Officer ID" : "Email";
        return res.status(409).json({
          success: false,
          error: `${field} already registered. Please sign in.`,
          code: "MONGO_DUPLICATE",
          field: mongoError.keyPattern?.officerId ? "officerId" : "email"
        });
      }
      throw mongoError;
    }

    // 5. ✅ Trigger Firebase email verification link (non-fatal if fails)
    try {
      await adminAuth.generateEmailVerificationLink(normalizedEmail);
    } catch (emailError) {
      // Non-critical: account still works, user can request resend later
      console.warn("⚠️ Verification email send failed (non-fatal):", emailError);
    }

    // 6. ✅ Success response
    res.status(201).json({
      success: true,
      message: "✅ Account created. Check your email (including spam folder) to verify. Your account is pending admin approval (24-48 hours).",
      officerId: normalizedOfficerId,
      email: normalizedEmail,
    });

  } catch (error: any) {
    // Catch-all for unexpected errors
    console.error("❌ Registration error:", error);
    Errors.internal(res, "POST /api/auth/register", error);
  }
});

// ✅ CRITICAL: Default export for Bun/ESM compatibility
export default router;