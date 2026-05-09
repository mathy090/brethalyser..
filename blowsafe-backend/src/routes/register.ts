// blowsafe-backend/src/routes/register.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { adminAuth } from "../config/firebase"; // Firebase Admin SDK
import { Officer } from "../models/Officer";    // Mongoose model

const router = Router();

// Validation schema (server-side)
const registerSchema = z.object({
  officerId: z
    .string()
    .regex(/^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i, "Invalid Officer ID format (e.g., A123456B)"),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[!@#$%^&*]/, "Password must contain at least one special character"),
});

/**
 * POST /api/auth/register
 * Public route: Creates Firebase user + MongoDB officer record (status: pending)
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    // 1. Validate input
    const { officerId, email, password } = registerSchema.parse(req.body);

    // 2. Check for duplicates BEFORE creating anything
    const existingOfficer = await Officer.findOne({ 
      $or: [{ email }, { officerId }] 
    });
    if (existingOfficer) {
      const field = existingOfficer.email === email ? "email" : "officerId";
      return res.status(409).json({ 
        success: false, 
        error: `${field.charAt(0).toUpperCase() + field.slice(1)} already registered.` 
      });
    }

    // 3. Create Firebase Auth user (Admin SDK - secure, server-side)
    const firebaseUser = await adminAuth.createUser({
      email,
      password,
      emailVerified: false, // User must verify via email link
      disabled: false,
    });

    // 4. Create MongoDB officer record with PENDING status
    const officer = await Officer.create({
      firebaseUid: firebaseUser.uid, // Link to Firebase
      officerId,
      email,
      role: "officer",        // ← Hardcoded: user cannot escalate
      status: "pending",      // ← DEFAULT: awaits admin approval
      createdAt: new Date(),
      approvalRequestedAt: new Date(),
    });

    // 5. Trigger Firebase email verification (auto-sends to user)
    await adminAuth.generateEmailVerificationLink(email);

    // 6. Respond (NEVER expose passwords, tokens, or internal IDs)
    return res.status(201).json({
      success: true,
      message: "✅ Account created. Check your email (including spam folder) to verify. Your account is pending admin approval (24-48 hours).",
      // Optional: return only safe, non-sensitive data
      officerId: officer.officerId,
      email: officer.email,
    });

  } catch (error) {
    // Zod validation errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        success: false, 
        error: error.errors[0].message 
      });
    }

    // Firebase Admin errors
    if (error.code === "auth/email-already-exists") {
      return res.status(409).json({ 
        success: false, 
        error: "Email already registered in Firebase." 
      });
    }
    if (error.code === "auth/invalid-email") {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid email address." 
      });
    }
    if (error.code === "auth/weak-password") {
      return res.status(400).json({ 
        success: false, 
        error: "Password is too weak." 
      });
    }

    // Catch-all
    console.error("❌ Registration error:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Registration failed. Please try again." 
    });
  }
});

export default router;