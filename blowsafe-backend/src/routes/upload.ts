/**
 * src/routes/upload.ts
 * Unauthenticated route for uploading driver ID photo + BAC reading data
 * Stores photo in /uploads and metadata in MongoDB
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

// ─── Multer config (SAFE) ───────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir); // ❗ no async here
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
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
    // Handle client aborts gracefully
    req.on("aborted", () => {
      console.log("⚠️ Client aborted upload request");
      if (!res.headersSent) {
        res.status(499).json({ error: "Upload cancelled by client" });
      }
    });

    try {
      const { parsedDriver, parsedBac } = req;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "Photo is required" });
      }

      // Build public URL (adjust for your deployment)
      const photoUrl = `${env.API_BASE_URL}/uploads/driver-photos/${file.filename}`;

      // Save driver
      const driver: IDriver = await Driver.create({
        ...parsedDriver,
        photoUrl,
      });

      // Save BAC reading
      const reading: IBacReading = await BacReading.create({
        driver: driver._id,
        bacValue: Number(parsedBac.bac),
        overLimit: parsedBac.overLimit,
        fineAmount: Number(parsedBac.fine),
        recordedAt: new Date(parsedBac.timestamp),
      });

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

// ─── Serve uploads (DEV ONLY) ───────────────────────────────────────────
if (env.NODE_ENV === "development") {
  router.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
}

export default router;