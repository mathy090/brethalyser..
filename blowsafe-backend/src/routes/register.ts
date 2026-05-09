import { Router, Request, Response } from "express";
import { adminAuth } from "../config/firebase";
import { Officer } from "../models/Officer";

const router = Router();

// ============================================
// VALIDATION (ONLY BASIC)
// ============================================
const validateRegistration = (body: any) => {
  const { officerId, email } = body;

  if (!officerId || !/^[A-Z]\d{6}[A-Z]$|^\d{9}$/i.test(officerId)) {
    return { code: "INVALID_OFFICER_ID", message: "Invalid Officer ID format" };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: "INVALID_EMAIL", message: "Invalid email address" };
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

  console.log("🚔 REGISTER:", normalizedOfficerId, normalizedEmail);

  // ============================================
  // 1. VALIDATION
  // ============================================
  const validationError = validateRegistration(req.body);
  if (validationError) {
    return res.status(400).json({
      success: false,
      code: validationError.code,
      error: validationError.message,
    });
  }

  // ============================================
  // 2. OFFICER ID CHECK (STOP HERE ONLY)
  // ============================================
  const existingOfficer = await Officer.findOne({
    officerId: normalizedOfficerId,
  });

  if (existingOfficer) {
    if (existingOfficer.email !== normalizedEmail) {
      console.log("🚫 BLOCKED OFFICER ID USED BY OTHER EMAIL");

      return res.status(409).json({
        success: false,
        code: "OFFICER_ID_IN_USE",
        error: "Please use your official officer ID",
      }); // 🔴 HARD STOP
    }

    return res.status(409).json({
      success: false,
      code: "ACCOUNT_EXISTS",
      error: "Account already exists",
    }); // 🔴 HARD STOP
  }

  // ============================================
  // 3. FIREBASE CREATE (ONLY IF CLEAN)
  // ============================================
  let firebaseUser;

  try {
    firebaseUser = await adminAuth.createUser({
      email: normalizedEmail,
      password,
      emailVerified: false,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      code: "FIREBASE_CREATE_FAILED",
      error: err.message,
    });
  }

  // ============================================
  // 4. MONGO CREATE (PENDING)
  // ============================================
  try {
    await Officer.create({
      officerId: normalizedOfficerId,
      email: normalizedEmail,
      firebaseUid: firebaseUser.uid,
      role: "officer",
      status: "pending",
      createdAt: new Date(),
    });
  } catch (err) {
    // rollback firebase
    await adminAuth.deleteUser(firebaseUser.uid);

    return res.status(500).json({
      success: false,
      code: "MONGO_CREATE_FAILED",
      error: "Database failed, rollback executed",
    });
  }

  // ============================================
  // 5. SEND VERIFICATION EMAIL
  // ============================================
  try {
    await adminAuth.generateEmailVerificationLink(normalizedEmail);
  } catch (e) {
    console.log("EMAIL SEND FAILED (non-fatal)");
  }

  // ============================================
  // SUCCESS
  // ============================================
  return res.status(201).json({
    success: true,
    code: "ACCOUNT_CREATED",
    message: "Account created successfully",
  });
});

export default router;