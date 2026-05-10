/**
 * blowsafe-backend/src/auth/login.ts
 * Handles POST /api/auth/login
 */
import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

const router = Router();

// 🔹 Mock DB for dev (replace with Prisma/Mongoose/PostgreSQL later)
const OFFICERS_DB: Record<string, { officerId: string; role: string; status: string; email: string }> = {
  "A123456B": { officerId: "A123456B", role: "admin", status: "approved", email: "admin@zrp.gov.zw" },
  "123456789": { officerId: "123456789", role: "officer", status: "approved", email: "officer@zrp.gov.zw" },
  "PENDING01": { officerId: "PENDING01", role: "officer", status: "pending", email: "pending@zrp.gov.zw" },
  "BANNED001": { officerId: "BANNED001", role: "officer", status: "banned", email: "banned@zrp.gov.zw" },
};

// ✅ MUST use "/" because Express strips "/api/auth/login" from the path
router.post("/", async (req: Request, res: Response) => {
  console.log("🔐 LOGIN ROUTE EXECUTING | Path:", req.originalUrl);
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ code: "MISSING_TOKEN", message: "Missing Firebase ID token." });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    const { officerId } = req.body;

    if (!officerId) {
      return res.status(400).json({ code: "MISSING_OFFICER_ID", message: "Officer ID is required." });
    }

    const officer = OFFICERS_DB[officerId.trim().toUpperCase()];
    if (!officer) {
      return res.status(404).json({ code: "OFFICER_NOT_FOUND", message: "Officer ID not found." });
    }

    if (officer.email.toLowerCase() !== decoded.email?.toLowerCase()) {
      return res.status(403).json({ code: "EMAIL_MISMATCH", message: "Email does not match officer record." });
    }

    if (officer.status === "pending") {
      return res.status(403).json({ code: "ACCOUNT_PENDING", message: "Account pending approval." });
    }
    if (["banned", "rejected"].includes(officer.status)) {
      return res.status(403).json({ code: "ACCOUNT_REJECTED", message: "Account has been banned." });
    }

    const blowSafeToken = jwt.sign(
      { uid: decoded.uid, officerId: officer.officerId, role: officer.role, status: officer.status },
      env.JWT_SECRET || "dev-fallback-secret",
      { expiresIn: "5m" }
    );

    return res.status(200).json({
      token: blowSafeToken,
      officerId: officer.officerId,
      role: officer.role,
      status: officer.status,
    });
  } catch (error: any) {
    console.error("❌ Login Error:", error.message);
    if (error.code?.includes("auth/")) {
      return res.status(401).json({ code: "INVALID_TOKEN", message: "Invalid Firebase token." });
    }
    return res.status(500).json({ code: "SERVER_ERROR", message: "Internal server error." });
  }
});

export default router;