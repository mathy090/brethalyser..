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
 * Checks officerId FIRST → logs warning if exists → returns instant error
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

    // 2. 🔍 CHECK OFFICER ID FIRST (before ANY Firebase/DB writes)
    const existingOfficer = await Officer.findOne({ 
      officerId: { $regex: new RegExp(`^${normalizedOfficerId}$`, 'i') } 
    });

    if (existingOfficer) {
      // 🚨 LOG TO BACKEND: Security audit trail
      console.warn(`⚠️ REGISTRATION BLOCKED: Officer ID "${normalizedOfficerId}" already in use. IP: ${req.ip}, Email attempted: "${normalizedEmail}", Timestamp: ${new Date().toISOString()}`);
      
      // Return specific error for frontend
      return res.status(409).json({
        success: false,
        error: "User account already in use, use your actual ID officer",
        code: "OFFICER_ID_ALREADY_EXISTS",
        field: "officerId"
      });
    }

    // 3. Check email uniqueness (secondary check)
    const existingEmail = await Officer.findOne({ email: normalizedEmail });
    if (existingEmail) {
      console.warn(`⚠️ REGISTRATION BLOCKED: Email "${normalizedEmail}" already registered. IP: ${req.ip}, Officer ID attempted: "${normalizedOfficerId}", Timestamp: ${new Date().toISOString()}`);
      
      const statusMsg = existingEmail.status === "approved" || existingEmail.status === "active"
        ? "Email already registered and approved. Please sign in."
        : `Email already registered. Status: ${existingEmail.status.toUpperCase()}`;
      
      return res.status(409).json({
        success: false,
        error: statusMsg,
        code: "EMAIL_ALREADY_EXISTS",
        field: "email",
        status: existingEmail.status
      });
    }

    // 4. ✅ All clear → Create Firebase Auth user
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.createUser({
        email: normalizedEmail,
        password,
        emailVerified: false,
        disabled: false,
      });
    } catch (firebaseError: any) {
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

    // 5. ✅ Create MongoDB officer record (status: pending)
    try {
      await Officer.create({
        firebaseUid: firebaseUser.uid,
        officerId: normalizedOfficerId,
        email: normalizedEmail,
        role: "officer",
        status: "pending",
        createdAt: new Date(),
        approvalRequestedAt: new Date(),
      });
    } catch (mongoError: any) {
      if (mongoError.code === 11000) {
        // Cleanup Firebase user to avoid orphans
        try { await adminAuth.deleteUser(firebaseUser.uid); } catch (e) { console.warn("⚠️ Firebase cleanup failed:", e); }
        
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

    // 6. ✅ Trigger verification email (non-fatal if fails)
    try {
      await adminAuth.generateEmailVerificationLink(normalizedEmail);
    } catch (e) {
      console.warn("⚠️ Verification email send failed:", e);
    }

    // 7. ✅ Success response
    res.status(201).json({
      success: true,
      message: "✅ Account created. Check your email (including spam folder) to verify. Your account is pending admin approval (24-48 hours).",
      officerId: normalizedOfficerId,
      email: normalizedEmail,
    });

  } catch (error: any) {
    console.error("❌ Registration error:", error);
    Errors.internal(res, "POST /api/auth/register", error);
  }
});

export default router;