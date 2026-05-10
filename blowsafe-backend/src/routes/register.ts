import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";

const router = Router();

// ============================================
// VALIDATION
// ============================================
const validateRegistration = (body: any) => {
  const { officerId, email, password } = body;

  if (!officerId || !/^[A-Z]\d{6}[A-Z]$|^\d{9}$/i.test(officerId)) {
    return { code: "INVALID_OFFICER_ID", message: "Invalid Officer ID format" };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: "INVALID_EMAIL", message: "Invalid email address" };
  }

  if (!password || password.length < 6) {
    return { code: "WEAK_PASSWORD", message: "Password too short" };
  }

  return null;
};

// ============================================
// REGISTER
// ============================================
router.post("/", async (req: Request, res: Response) => {
  const { officerId, email, password } = req.body;

  const normalizedOfficerId = officerId?.toUpperCase().trim();
  const normalizedEmail = email?.toLowerCase().trim();

  console.log("\n========================================");
  console.log("🚔 NEW REGISTRATION");
  console.log("Officer ID:", normalizedOfficerId);
  console.log("Email:", normalizedEmail);
  console.log("========================================");

  // 1. VALIDATION
  const validationError = validateRegistration(req.body);
  if (validationError) {
    return res.status(400).json({
      success: false,
      code: validationError.code,
      error: validationError.message,
    });
  }

  // 2. CHECK OFFICER ID (MONGO ONLY)
  console.log("🔍 Checking Officer ID...");

  const existingOfficer = await Officer.findOne({
    officerId: normalizedOfficerId,
  });

  if (existingOfficer) {
    console.log("🚫 Officer ID already exists");

    return res.status(409).json({
      success: false,
      code: "OFFICER_ID_IN_USE",
      error: "Please use your official officer ID",
    });
  }

  console.log("✅ Officer ID OK");

  // 3. CHECK FIREBASE EMAIL
  console.log("🔍 Checking Firebase email...");

  try {
    await adminAuth.getUserByEmail(normalizedEmail);

    console.log("🚫 Email already exists in Firebase");

    return res.status(409).json({
      success: false,
      code: "EMAIL_EXISTS",
      error: "Account already exists",
    });
  } catch (err: any) {
    if (err.code !== "auth/user-not-found") {
      return res.status(500).json({
        success: false,
        code: "FIREBASE_CHECK_FAILED",
        error: err.message,
      });
    }
  }

  console.log("✅ Email available");

  // 4. CREATE FIREBASE USER
  console.log("🔥 Creating Firebase user...");

  const firebaseUser = await adminAuth.createUser({
    email: normalizedEmail,
    password,
    emailVerified: false,
  });

  console.log("✅ Firebase user created:", firebaseUser.uid);

  // 5. SEND VERIFICATION LINK (ONLY TO THIS EMAIL)
  console.log("📧 Sending verification link...");

  const verificationLink =
    await adminAuth.generateEmailVerificationLink(normalizedEmail);

  console.log("🔗 Verification link generated");
  console.log(verificationLink);

  // (IMPORTANT: YOU must email it via SMTP or service)
  // Firebase DOES NOT send email automatically here

  // 6. CREATE MONGO USER
  console.log("🗄️ Creating MongoDB user...");

  await Officer.create({
    officerId: normalizedOfficerId,
    email: normalizedEmail,
    firebaseUid: firebaseUser.uid,
    role: "officer",
    status: "pending",
    createdAt: new Date(),
  });

  console.log("✅ MongoDB user created (pending)");

  // 7. RESPONSE
  console.log("🎉 REGISTRATION COMPLETE");

  return res.status(201).json({
    success: true,
    code: "ACCOUNT_CREATED",
    message: "Account created. Check your email to verify.",
  });
});

export default router;