import { Router, Request, Response } from 'express';
import admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// 🔹 Initialize Firebase Admin (runs once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
  });
}

const router = Router();

// 🗃️ Mock DB for dev (replace with Prisma/Mongoose/PostgreSQL later)
const OFFICERS_DB: Record<string, { officerId: string; role: string; status: string; email: string }> = {
  'A123456B': { officerId: 'A123456B', role: 'admin', status: 'approved', email: 'admin@zrp.gov.zw' },
  '123456789': { officerId: '123456789', role: 'officer', status: 'approved', email: 'officer@zrp.gov.zw' },
  'PENDING01': { officerId: 'PENDING01', role: 'officer', status: 'pending', email: 'pending@zrp.gov.zw' },
  'BANNED001': { officerId: 'BANNED001', role: 'officer', status: 'banned', email: 'banned@zrp.gov.zw' },
};

// 🔐 POST /api/auth/login
router.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    // 1️⃣ Grab & validate Firebase ID Token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ code: 'MISSING_TOKEN', message: 'Missing Firebase ID token.' });
    }
    const idToken = authHeader.split('Bearer ')[1];

    // 2️⃣ Verify token with Firebase
    const decoded = await admin.auth().verifyIdToken(idToken);
    const firebaseEmail = decoded.email;
    const firebaseUid = decoded.uid;

    // 3️⃣ Extract Officer ID
    const { officerId } = req.body;
    if (!officerId) {
      return res.status(400).json({ code: 'MISSING_OFFICER_ID', message: 'Officer ID is required.' });
    }

    // 4️⃣ Lookup officer
    const officer = OFFICERS_DB[officerId.trim().toUpperCase()];
    if (!officer) {
      return res.status(404).json({ code: 'OFFICER_NOT_FOUND', message: 'Officer ID not found.' });
    }

    // 5️⃣ Email match check
    if (officer.email.toLowerCase() !== firebaseEmail?.toLowerCase()) {
      return res.status(403).json({ code: 'EMAIL_MISMATCH', message: 'Email does not match officer record.' });
    }

    // 6️⃣ Status checks (matches your frontend banners)
    if (officer.status === 'pending') {
      return res.status(403).json({ code: 'ACCOUNT_PENDING', message: 'Account pending approval by admin.' });
    }
    if (['banned', 'rejected'].includes(officer.status)) {
      return res.status(403).json({ code: 'ACCOUNT_REJECTED', message: 'Account has been banned.' });
    }

    // 7️⃣ Generate 5-min BlowSafe JWT
    const blowSafeToken = jwt.sign(
      { uid: firebaseUid, officerId: officer.officerId, role: officer.role, status: officer.status },
      process.env.JWT_SECRET || 'dev-fallback-secret',
      { expiresIn: '5m' }
    );

    // 8️⃣ Return EXACT shape your Login.tsx expects
    return res.status(200).json({
      token: blowSafeToken,
      officerId: officer.officerId,
      role: officer.role,
      status: officer.status,
    });

  } catch (error: any) {
    console.error('🔴 LOGIN ERROR:', error);
    
    if (error.code?.includes('auth/id-token-expired') || error.code?.includes('auth/invalid-id-token')) {
      return res.status(401).json({ code: 'INVALID_TOKEN', message: 'Invalid or expired Firebase token.' });
    }
    
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Internal server error.' });
  }
});

export default router;