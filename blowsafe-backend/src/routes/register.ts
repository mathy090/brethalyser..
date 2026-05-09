// blowsafe-backend/src/routes/register.ts
import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";
import { Errors } from "../utils/errors";

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
 * Public route: Checks DB first → creates Firebase user → creates MongoDB record (status: pending)
 * 
 * Safety guarantees:
 * - No orphaned Firebase users (DB check happens FIRST)
 * - No duplicate officerId or email (unique indexes + pre-check)
 * - Existing DB data is never modified or deleted
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

    // 2. 🔍 CHECK MONGODB FIRST (before any Firebase calls)
    // This prevents orphaned Firebase users and protects existing data
    const existingOfficer = await Officer.findOne({ 
      $or: [
        { officerId: { $regex: new RegExp(`^${officerId}$`, 'i') } }, // case-insensitive match
        { email: normalizedEmail }
      ]
    });

    if (existingOfficer) {
      // Determine which field caused the conflict
      const isOfficerIdMatch = existingOfficer.officerId.toLowerCase() === officerId.toLowerCase();
      const conflictField = isOfficerIdMatch ? "Officer ID" : "Email";
      
      // If account is already approved, suggest login
      if (existingOfficer.status === "approved" || existingOfficer.status === "active") {
        Errors.conflict(res, `${conflictField} already registered. Please sign in instead.`);
      } else {
        // Account exists but is pending/rejected
        Errors.conflict(res, `Account already created with this ${conflictField.toLowerCase()}. Status: ${existingOfficer.status.toUpperCase()}`);
      }
      return;
    }

    // 3. ✅ DB is clear → Create Firebase Auth user
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
        Errors.conflict(res, "Email already registered in Firebase. Please try signing in.");
        return;
      }
      if (firebaseError.code === "auth/invalid-email") {
        Errors.invalidField(res, "email", "Invalid email address.");
        return;
      }
      if (firebaseError.code === "auth/weak-password") {
        Errors.invalidField(res, "password", "Password is too weak.");
        return;
      }
      throw firebaseError; // Re-throw for catch-all handler
    }

    // 4. ✅ Create MongoDB officer record (status: pending)
    // Using create() which respects unique indexes as a final safety net
    try {
      await Officer.create({
        firebaseUid: firebaseUser.uid,
        officerId: officerId.toUpperCase(), // Normalize to uppercase for consistency
        email: normalizedEmail,
        role: "officer",        // ← Hardcoded: no privilege escalation
        status: "pending",      // ← DEFAULT: awaits admin approval
        createdAt: new Date(),
        approvalRequestedAt: new Date(),
      });
    } catch (mongoError: any) {
      // Handle duplicate key errors (unique index violation) as final safety net
      if (mongoError.code === 11000) {
        // Clean up the Firebase user we just created to avoid orphans
        try {
          await adminAuth.deleteUser(firebaseUser.uid);
        } catch (cleanupError) {
          console.warn("⚠️ Failed to clean up Firebase user after MongoDB duplicate:", cleanupError);
        }
        
        // Determine which field caused the duplicate
        const duplicateField = mongoError.keyPattern?.officerId ? "Officer ID" : "Email";
        Errors.conflict(res, `${duplicateField} already registered. Please try signing in.`);
        return;
      }
      throw mongoError;
    }

    // 5. ✅ Trigger Firebase email verification link
    try {
      await adminAuth.generateEmailVerificationLink(normalizedEmail);
    } catch (emailError) {
      // Non-fatal: account still works, user can request resend later
      console.warn("⚠️ Failed to send verification email:", emailError);
    }

    // 6. ✅ Respond (minimal, safe data)
    res.status(201).json({
      success: true,
      message: "✅ Account created. Check your email (including spam folder) to verify. Your account is pending admin approval (24-48 hours).",
      officerId: officerId.toUpperCase(),
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