import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";

const router = Router();

// ============================================
// VALIDATION
// ============================================
const validateRegistration = (body: any) => {
  const { officerId, email, password } = body;

  if (
    !officerId ||
    !/^[A-Z]\d{6}[A-Z]$|^\d{9}$/i.test(officerId)
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

  if (!password || password.length < 6) {
    return {
      code: "WEAK_PASSWORD",
      message: "Password must be at least 6 characters",
    };
  }

  return null;
};

// ============================================
// REGISTER
// ============================================
router.post("/", async (req: Request, res: Response) => {

  const { officerId, email, password } = req.body;

  const normalizedOfficerId =
    officerId?.toUpperCase().trim();

  const normalizedEmail =
    email?.toLowerCase().trim();

  console.log("\n========================================");
  console.log("🚔 NEW REGISTRATION");
  console.log("Officer ID:", normalizedOfficerId);
  console.log("Email:", normalizedEmail);
  console.log("IP:", req.ip);
  console.log("========================================");

  // ============================================
  // 1. VALIDATION
  // ============================================
  const validationError =
    validateRegistration(req.body);

  if (validationError) {

    console.log(
      "❌ VALIDATION FAILED:",
      validationError.code
    );

    return res.status(400).json({
      success: false,
      code: validationError.code,
      error: validationError.message,
    });
  }

  // ============================================
  // 2. CHECK OFFICER ID FIRST
  // ============================================
  console.log(
    "🔍 Checking Officer ID..."
  );

  const existingOfficer =
    await Officer.findOne({
      officerId: normalizedOfficerId,
    });

  // Officer ID belongs to another email
  if (
    existingOfficer &&
    existingOfficer.email.toLowerCase() !==
      normalizedEmail
  ) {

    console.log(
      "🚫 OFFICER ID ALREADY USED"
    );

    console.log(
      "Existing Email:",
      existingOfficer.email
    );

    return res.status(409).json({
      success: false,
      code: "OFFICER_ID_IN_USE",
      error:
        "Please use your official officer ID",
    });
  }

  // Same account already exists
  if (
    existingOfficer &&
    existingOfficer.email.toLowerCase() ===
      normalizedEmail
  ) {

    console.log(
      "🚫 ACCOUNT ALREADY EXISTS IN MONGODB"
    );

    return res.status(409).json({
      success: false,
      code: "ACCOUNT_EXISTS",
      error: "Account already exists",
    });
  }

  console.log(
    "✅ Officer ID available"
  );

  // ============================================
  // 3. CHECK FIREBASE EMAIL
  // ============================================
  console.log(
    "🔍 Checking Firebase email..."
  );

  let firebaseEmailExists = false;

  try {

    await adminAuth.getUserByEmail(
      normalizedEmail
    );

    firebaseEmailExists = true;

  } catch (err: any) {

    if (
      err.code === "auth/user-not-found"
    ) {
      firebaseEmailExists = false;
    }
  }

  // Email already exists
  if (firebaseEmailExists) {

    console.log(
      "🚫 EMAIL ALREADY EXISTS IN FIREBASE"
    );

    return res.status(409).json({
      success: false,
      code: "EMAIL_EXISTS",
      error: "Account already exists",
    });
  }

  console.log(
    "✅ Firebase email available"
  );

  // ============================================
  // 4. CREATE FIREBASE ACCOUNT
  // ============================================
  console.log(
    "🔥 Creating Firebase account..."
  );

  const firebaseUser =
    await adminAuth.createUser({
      email: normalizedEmail,
      password,
      emailVerified: false,
      disabled: false,
    });

  console.log(
    "✅ Firebase account created"
  );

  console.log(
    "UID:",
    firebaseUser.uid
  );

  // ============================================
  // 5. GENERATE VERIFICATION LINK
  // ============================================
  console.log(
    "📧 Generating verification link..."
  );

  const verificationLink =
    await adminAuth.generateEmailVerificationLink(
      normalizedEmail
    );

  console.log(
    "✅ Verification link generated"
  );

  console.log(
    verificationLink
  );

  // ============================================
  // 6. CREATE MONGODB USER
  // ============================================
  console.log(
    "🗄️ Creating MongoDB officer..."
  );

  await Officer.create({
    officerId: normalizedOfficerId,
    email: normalizedEmail,
    firebaseUid: firebaseUser.uid,
    role: "officer",
    status: "pending",
    createdAt: new Date(),
  });

  console.log(
    "✅ MongoDB officer created"
  );

  console.log(
    "Status: pending"
  );

  // ============================================
  // SUCCESS
  // ============================================
  console.log("\n========================================");
  console.log("🎉 REGISTRATION SUCCESS");
  console.log("Officer:", normalizedOfficerId);
  console.log("Email:", normalizedEmail);
  console.log("========================================\n");

  return res.status(201).json({
    success: true,
    code: "ACCOUNT_CREATED",
    message:
      "Account created successfully",
  });

});

export default router;