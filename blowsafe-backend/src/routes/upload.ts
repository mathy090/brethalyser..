/**
 * src/routes/upload.ts
 * Unauthenticated route for uploading driver + BAC data
 */
import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { Driver, BacReading } from "../models/BacUpload";
import { env } from "../config/env";

const router = express.Router();

// ─── Multer Configuration (File Upload) ─────────────────────────────────────
// Store files in /uploads with unique names
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads", "driver-photos");
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

// File filter: only allow images
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

// ─── Validation Middleware ──────────────────────────────────────────────────
const validateUpload = (req: Request, _res: Response, next: NextFunction) => {
  const { driverData, bacData } = req.body;

  if (!driverData || !bacData) {
    return res.status(400).json({ error: "Please enter all information" });
  }

  try {
    const driver = JSON.parse(driverData);
    const bac = JSON.parse(bacData);

    const requiredDriverFields = [
      "surname", "firstName", "dateOfBirth", "gender",
      "idNumber", "licenceNumber", "licenceCode", "issueDate", "expiryDate"
    ];

    const missingFields = requiredDriverFields.filter(
      (field) => !driver[field] || driver[field].trim() === ""
    );

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: "Please enter all information",
        missing: missingFields 
      });
    }

    if (bac.bac === undefined || bac.fine === undefined || !bac.timestamp) {
      return res.status(400).json({ error: "Please enter all information" });
    }

    // Attach parsed data to request for use in handler
    req.parsedDriver = driver;
    req.parsedBac = bac;
    next();
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON in form data" });
  }
};

// Extend Request type to include parsed data
declare global {
  namespace Express {
    interface Request {
      parsedDriver?: any;
      parsedBac?: any;
    }
  }
}

// ─── POST /api/upload ───────────────────────────────────────────────────────
router.post(
  "/api/upload",
  upload.single("photo"),
  validateUpload,
  async (req: Request, res: Response) => {
    try {
      const { parsedDriver, parsedBac } = req;
      const photoFile = req.file;

      if (!photoFile) {
        return res.status(400).json({ error: "Please enter all information" });
      }

      // Generate public URL for the photo (adjust for your deployment)
      const photoUrl = `${env.API_BASE_URL}/uploads/driver-photos/${photoFile.filename}`;

      // 1. Create Driver document
      const driver = await Driver.create({
        ...parsedDriver,
        photoUrl,
      });

      // 2. Create BAC Reading document linked to driver
      const reading = await BacReading.create({
        driver: driver._id,
        bacValue: parseFloat(parsedBac.bac),
        overLimit: parsedBac.overLimit,
        fineAmount: parseFloat(parsedBac.fine),
        recordedAt: new Date(parsedBac.timestamp),
      });

      res.status(201).json({
        success: true,
        message: "Upload successful",
        data: {
          driverId: driver._id,
          readingId: reading._id,
          photoUrl,
        },
      });
    } catch (error: any) {
      console.error("Upload error:", error);

      // Handle duplicate key errors (idNumber or licenceNumber)
      if (error.code === 11000) {
        return res.status(409).json({ 
          error: "Driver with this ID or Licence Number already exists" 
        });
      }

      res.status(500).json({ 
        error: "Failed to upload data", 
        details: env.NODE_ENV === "development" ? error.message : undefined 
      });
    }
  }
);

// ─── Serve uploaded files (Development only) ────────────────────────────────
if (env.NODE_ENV === "development") {
  router.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
}

export default router;