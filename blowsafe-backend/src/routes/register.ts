/**
 * src/routes/register.ts
 */

import { Router } from "express";
import admin from "../config/firebase";
import { Officer } from "../models/Officer";
import { sendMail } from "../utils/mailer";

const router = Router();

// ─── Validation ───────────────────────────────────────────────

function validate(body: any) {
  const { officerId, email, password } = body;

  if (
    !officerId ||
    !/^[A-Z]\d{6}[A-Z]$|^\d{9}$/i.test(officerId)
  ) {
    return {
      code: "INVALID_OFFICER_ID",
      message: "Invalid Officer ID",
    };
  }

  if (!email || !email.includes("@")) {
    return {
      code: "INVALID_EMAIL",
      message: "Invalid email",
    };
  }

  if (!password || password.length < 6) {
    return {
      code: "WEAK_PASSWORD",
      message: "Weak password",
    };
  }

  return null;
}

// ─── Register ───────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { officerId, email, password } = req.body;

  const normId = officerId?.toUpperCase().trim();
  const normEmail = email?.toLowerCase().trim();

  // 1. Validate
  const err = validate(req.body);

  if (err) {
    return res.status(400).json({
      success: false,
      ...err,
    });
  }

  // 2. Check Officer ID
  const exists = await Officer.findOne({
    officerId: normId,
  });

  if (exists) {
    return res.status(409).json({
      success: false,
      code: "OFFICER_ID_IN_USE",
      error: "Officer ID already exists",
    });
  }

  // 3. Check Firebase email
  try {
    await admin.auth().getUserByEmail(normEmail);

    return res.status(409).json({
      success: false,
      code: "EMAIL_EXISTS",
      error: "Email already exists",
    });

  } catch (e: any) {

    if (e.code !== "auth/user-not-found") {
      return res.status(500).json({
        success: false,
        code: "FIREBASE_ERROR",
      });
    }
  }

  // 4. Create Firebase user
  const user = await admin.auth().createUser({
    email: normEmail,
    password,
    emailVerified: false,
  });

  // 5. Generate verification link
  const link = await admin
    .auth()
    .generateEmailVerificationLink(normEmail);

  // 6. SEND EMAIL via Resend
  await sendMail({
    to: normEmail,
    subject: "ZRP Account Verification",
    text: `Verify your account:\n\n${link}`,
    html: `
      <div style="font-family:sans-serif;padding:20px;">
        <h2>ZRP Account Verification</h2>
        <p>Click below to verify your account:</p>

        <a href="${link}"
           style="
             display:inline-block;
             padding:12px 24px;
             background:#2563eb;
             color:white;
             text-decoration:none;
             border-radius:8px;
             font-weight:bold;
           ">
          Verify Account
        </a>
      </div>
    `,
  });

  // 7. Save MongoDB user
  await Officer.create({
    officerId: normId,
    email: normEmail,
    firebaseUid: user.uid,
    status: "pending",
    createdAt: new Date(),
  });

  console.log("✅ Registered:", normId);

  return res.status(201).json({
    success: true,
    message:
      "Account created. Check email to verify.",
  });
});

export default router;