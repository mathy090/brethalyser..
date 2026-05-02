import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { Driver, BacReading } from "../models/BacUpload";
import { env } from "../config/env";

const router = express.Router();

// ─── Multer config ─────────────────────────────────
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const dir = path.join(process.cwd(), "uploads", "driver-photos");
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ─── Validation ────────────────────────────────────
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
    return res.status(400).json({ error: "Invalid JSON" });
  }
};

// Extend request
declare global {
  namespace Express {
    interface Request {
      parsedDriver?: any;
      parsedBac?: any;
    }
  }
}

// ─── POST /api/upload (FINAL CORRECT ROUTE) ─────────
router.post(
  "/upload",
  upload.single("photo"),
  validateUpload,
  async (req: Request, res: Response) => {
    try {
      const { parsedDriver, parsedBac } = req;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "Photo required" });
      }

      const photoUrl = `${env.API_BASE_URL}/uploads/driver-photos/${file.filename}`;

      const driver = await Driver.create({
        ...parsedDriver,
        photoUrl,
      });

      const reading = await BacReading.create({
        driver: driver._id,
        bacValue: parseFloat(parsedBac.bac),
        overLimit: parsedBac.overLimit,
        fineAmount: parsedBac.fine,
        recordedAt: new Date(parsedBac.timestamp),
      });

      res.status(201).json({
        success: true,
        driverId: driver._id,
        readingId: reading._id,
        photoUrl,
      });

    } catch (err: any) {
      console.error("Upload error:", err);

      res.status(500).json({
        error: "Upload failed",
        details: env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  }
);

// Serve uploads (dev)
if (env.NODE_ENV === "development") {
  router.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
}

export default router;