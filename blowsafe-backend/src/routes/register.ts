// blowsafe-backend/src/routes/register.ts

import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";

const router = Router();

// ============================================
// VALIDATION
// ============================================
const validateRegistration = (body: any) => {
  const { officerId, email } = body;

  // ONLY validate officer ID + email
  // NO PASSWORD VALIDATION

  if (
    !officerId ||
    !/^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i.test(officerId)
  ) {
    return {
      code: "INVALID_OFFICER_ID",
      message: "Invalid Officer ID format",
    };
  }

  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return {
      code: "INVALID_EMAIL",
      message: "Invalid email address",
    };
  }

  return null;
};

// ============================================
// REGISTER
// ============================================
router.post("/", async (req: Request, res: Response) => {
  try {
    const { officerId, email, password } = req.body;

    const normalizedOfficerId =
      officerId?.toUpperCase().trim();

    const normalizedEmail =
      email?.toLowerCase().trim();

    console.log("\n=======================================");
    console.log("🚔 NEW REGISTRATION ATTEMPT");
    console.log("Officer ID:", normalizedOfficerId);
    console.log("Email:", normalizedEmail);
    console.log("IP:", req.ip);
    console.log("=======================================\n");

    // ============================================
    // 1. VALIDATION
    // ============================================
    const validationError =
      validateRegistration(req.body);

    if (validationError) {
      console.log(
        "❌ Validation failed:",
        validationError.code
      );

      return res.status(400).json({
        success: false,
        code: validationError.code,
        error: validationError.message,
      });
    }

    // ============================================
    // 2. CHECK OFFICER ID ONLY
    // ============================================
    console.log("🔍 Checking Officer ID in MongoDB...");

    const existingOfficer = await Officer.findOne({
      officerId: normalizedOfficerId,
    });

    // OFFICER ID EXISTS
    if (existingOfficer) {

      // DIFFERENT EMAIL USING SAME ID
      if (
        existingOfficer.email.toLowerCase() !==
        normalizedEmail
      ) {
        console.log("🚫 BLOCKED");
        console.log(
          `Officer ID ${normalizedOfficerId} already belongs to another email`
        );

        console.log(
          `Existing Email: ${existingOfficer.email}`
        );

        console.log(
          `Attempted Email: ${normalizedEmail}`
        );

        return res.status(409).json({
          success: false,
          code: "OFFICER_ID_IN_USE",
          error:
            "Please use your official officer ID",
        });
      }

      // SAME EMAIL + SAME ID
      console.log("🚫 ACCOUNT ALREADY EXISTS");

      return res.status(409).json({
        success: false,
        code: "ACCOUNT_EXISTS",
        error: "Account already exists",
      });
    }

    console.log("✅ Officer ID available");

    // ============================================
    // 3. CREATE FIREBASE USER
    // ============================================
    console.log("🔥 Creating Firebase user...");

    let firebaseUser;

    try {
      firebaseUser = await adminAuth.createUser({
        email: normalizedEmail,
        password,
        emailVerified: false,
        disabled: false,
      });

      console.log("✅ Firebase user created");
      console.log("UID:", firebaseUser.uid);

    } catch (firebaseError: any) {

      console.log("❌ Firebase create failed");
      console.log(firebaseError);

      if (
        firebaseError.code ===
        "auth/email-already-exists"
      ) {
        return res.status(409).json({
          success: false,
          code: "EMAIL_EXISTS",
          error: "Email already registered",
        });
      }

      return res.status(500).json({
        success: false,
        code: "FIREBASE_CREATE_FAILED",
        error: firebaseError.message,
      });
    }

    // ============================================
    // 4. CREATE MONGODB USER
    // ============================================
    console.log("🗄️ Creating MongoDB officer...");

    try {

      await Officer.create({
        officerId: normalizedOfficerId,
        email: normalizedEmail,
        firebaseUid: firebaseUser.uid,
        role: "officer",
        status: "pending",
        createdAt: new Date(),
      });

      console.log("✅ MongoDB officer created");
      console.log("Status: pending");

    } catch (mongoError: any) {

      console.log("❌ MongoDB create failed");
      console.log(mongoError);

      // ============================================
      // 5. ROLLBACK FIREBASE USER
      // ============================================
      console.log("🧹 Rolling back Firebase user...");

      try {

        await adminAuth.deleteUser(firebaseUser.uid);

        console.log(
          "✅ Firebase rollback successful"
        );

      } catch (rollbackError) {

        console.log(
          "❌ Firebase rollback failed"
        );

        console.log(rollbackError);
      }

      return res.status(500).json({
        success: false,
        code: "MONGO_CREATE_FAILED",
        error:
          "Failed to create officer account",
      });
    }

    // ============================================
    // 6. SEND VERIFICATION LINK
    // ============================================
    console.log("📧 Generating verification link...");

    try {

      const verificationLink =
        await adminAuth.generateEmailVerificationLink(
          normalizedEmail
        );

      console.log(
        "✅ Verification link generated"
      );

      console.log(verificationLink);

    } catch (emailError) {

      console.log(
        "⚠️ Verification link generation failed"
      );

      console.log(emailError);
    }

    // ============================================
    // SUCCESS
    // ============================================
    console.log("\n🎉 REGISTRATION SUCCESS");
    console.log("Officer:", normalizedOfficerId);
    console.log("Email:", normalizedEmail);
    console.log("Status: pending");
    console.log("=======================================\n");

    return res.status(201).json({
      success: true,
      code: "ACCOUNT_CREATED",
      message:
        "Account created successfully. Verify your email and wait for admin approval.",
    });

  } catch (err: any) {

    console.log("❌ REGISTER ROUTE CRASHED");
    console.log(err);

    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      error: err.message,
    });
  }
});

export default router;