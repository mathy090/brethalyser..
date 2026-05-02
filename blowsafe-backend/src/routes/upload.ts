/**
 * src/routes/upload.ts
 * Unauthenticated route for uploading driver ID photo + BAC reading data
 * Follows same pattern as avatarRoutes.js
 */

import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Driver, BacReading, IDriver, IBacReading } from "../models/BacUpload";
import { env } from "../config/env";

const router = express.Router();

// ─── Ensure upload directory exists BEFORE multer uses it ───────────────
const uploadDir = path.join(process.cwd(), "uploads", "driver-photos");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── Multer config (MEMORY STORAGE - same as avatarRoutes) ──────────────
const upload = multer({
  storage: multer.memoryStorage(), // Store in RAM, not disk
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed"), false);
    }
  },
});

// ─── Validation Middleware ──────────────────────────────────────────────
const validateUpload = (req: Request, res: Response, next: NextFunction) => {
  const { driverData, bacData } = req.body;

  if (!driverData || !bacData) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    req.parsedDriver = JSON.parse(driverData);
    req.parsedBac = JSON.parse(bacData);
    next();
  } catch {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
};

// Extend request type
declare global {
  namespace Express {
    interface Request {
      parsedDriver?: any;
      parsedBac?: any;
    }
  }
}

// ─── POST /api/upload ───────────────────────────────────────────────────
router.post(
  "/upload",
  upload.single("photo"),
  validateUpload,
  async (req: Request, res: Response) => {
    try {
      const { parsedDriver, parsedBac } = req;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "Photo is required" });
      }

      // ── Save file to disk (same pattern as avatarRoutes) ──────────────
      const ext = file.mimetype.split("/")[1] ?? "jpg";
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const filename = `${unique}-driver.${ext}`;
      const filePath = path.join(uploadDir, filename);

      // Write buffer to disk
      fs.writeFileSync(filePath, file.buffer);

      // Build public URL (same manual construction as avatarRoutes)
      const photoUrl = `${env.API_BASE_URL}/uploads/driver-photos/${filename}`;

      // ── Save driver to MongoDB ────────────────────────────────────────
      const driver: IDriver = await Driver.create({
        ...parsedDriver,
        photoUrl,
      });

      // ── Save BAC reading to MongoDB ───────────────────────────────────
      const reading: IBacReading = await BacReading.create({
        driver: driver._id,
        bacValue: Number(parsedBac.bac),
        overLimit: parsedBac.overLimit,
        fineAmount: Number(parsedBac.fine),
        recordedAt: new Date(parsedBac.timestamp),
      });

      console.log(`[Upload] ✅ Saved driver ${driver._id} + reading ${reading._id}`);

      return res.status(201).json({
        success: true,
        message: "Upload successful",
        data: {
          driverId: driver._id,
          readingId: reading._id,
          photoUrl,
        },
      });

    } catch (err: any) {
      console.error("❌ Upload error:", err);

      // Handle MongoDB duplicate key error
      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0];
        return res.status(409).json({ 
          error: `Driver with this ${field} already exists` 
        });
      }

      return res.status(500).json({
        error: "Upload failed",
        details: env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  }
);

export default router;