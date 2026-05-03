/**
 * src/routes/upload.ts
 * Unauthenticated route for uploading driver ID photo + BAC reading data
 * Uses Supabase Storage + Supabase Database (Bun-compatible)
 */

import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

const router = express.Router();

// ─── Supabase Client (lazy singleton) ───────────────────────────────────────
let _supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("SUPABASE_URL env var not set");
  if (!supabaseKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY env var not set");

  _supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { apiKey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    },
  });

  return _supabase;
}

// ─── Multer config (MEMORY STORAGE) ─────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed"), false);
    }
  },
});

// ─── Validation Middleware ──────────────────────────────────────────────────
const validateUpload = (req: Request, res: Response, next: NextFunction) => {
  const { driverData, bacData } = req.body;

  if (!driverData || !bacData) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    (req as any).parsedDriver = JSON.parse(driverData);
    (req as any).parsedBac = JSON.parse(bacData);
    next();
  } catch {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
};

// ─── POST /api/upload ───────────────────────────────────────────────────────
router.post(
  "/upload",
  upload.single("photo"),
  validateUpload,
  async (req: Request, res: Response) => {
    try {
      const { parsedDriver, parsedBac } = req as any;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "Photo is required" });
      }

      const supabase = getSupabase();

      // ── 1. Upload photo to Supabase Storage ───────────────────────────────
      const ext = file.mimetype.split("/")[1] ?? "jpg";
      const safeIdNumber = parsedDriver.idNumber?.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const filePath = `driver-photos/${safeIdNumber}/${unique}-driver.${ext}`;

      console.log(`[Upload] Uploading to Supabase Storage: ${filePath}`);

      const { error: uploadError } = await supabase.storage
        .from("driver-photos")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
          cacheControl: "3600",
        });

      if (uploadError) {
        console.error("[Upload] Supabase Storage error:", uploadError);
        if (uploadError.message.includes("Bucket not found")) {
          return res.status(500).json({
            code: "BUCKET_NOT_FOUND",
            message: "Supabase 'driver-photos' bucket doesn't exist.",
          });
        }
        if (uploadError.message.includes("permission") || (uploadError as any).statusCode === 403) {
          return res.status(500).json({
            code: "PERMISSION_DENIED",
            message: "Service role key doesn't have write access to bucket.",
          });
        }
        return res.status(500).json({
          code: "UPLOAD_FAILED",
          message: uploadError.message,
        });
      }

      // ── 2. Build public URL ───────────────────────────────────────────────
      const supabaseUrl = process.env.SUPABASE_URL;
      const photoUrl = `${supabaseUrl}/storage/v1/object/public/driver-photos/${filePath}`;
      console.log(`[Upload] Public URL: ${photoUrl}`);

      // ── 3. Insert driver into Supabase Database ───────────────────────────
      const { data: driver, error: driverError } = await supabase
        .from("drivers")
        .insert({
          surname: parsedDriver.surname?.trim(),
          first_name: parsedDriver.firstName?.trim(),
          date_of_birth: parsedDriver.dateOfBirth,
          gender: parsedDriver.gender,
          id_number: parsedDriver.idNumber?.trim(),
          licence_number: parsedDriver.licenceNumber?.trim(),
          licence_code: parsedDriver.licenceCode?.trim(),
          issue_date: parsedDriver.issueDate,
          expiry_date: parsedDriver.expiryDate,
          photo_url: photoUrl,
        })
        .select()
        .single();

      if (driverError) {
        console.error("[Upload] Driver insert error:", driverError);
        if ((driverError as any).code === "23505") {
          const field = (driverError as any).detail?.includes("id_number") ? "idNumber" : "licenceNumber";
          return res.status(409).json({
            code: "DUPLICATE_ENTRY",
            message: `Driver with this ${field} already exists.`,
          });
        }
        return res.status(500).json({
          code: "DATABASE_ERROR",
          message: "Failed to save driver data.",
        });
      }

      // ── 4. Insert BAC reading into Supabase Database ──────────────────────
      const { data: reading, error: readingError } = await supabase
        .from("bac_readings")
        .insert({
          driver_id: driver.id,
          bac_value: Number(parsedBac.bac),
          over_limit: parsedBac.overLimit,
          fine_amount: Number(parsedBac.fine),
          recorded_at: new Date(parsedBac.timestamp).toISOString(),
        })
        .select()
        .single();

      if (readingError) {
        console.error("[Upload] BAC reading insert error:", readingError);
        return res.status(500).json({
          code: "DATABASE_ERROR",
          message: "Failed to save BAC reading.",
        });
      }

      console.log(`[Upload] ✅ Saved driver ${driver.id} + reading ${reading.id}`);

      // ✅ FIXED: Proper JSON response syntax with "data" key
      return res.status(201).json({
        success: true,
        message: "Upload successful",
        data: {
          driverId: driver.id,
          readingId: reading.id,
          photoUrl,
        },
      });

    } catch (err: any) {
      console.error("❌ Upload error:", err);

      return res.status(500).json({
        error: "Upload failed",
        details: env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  }
);

export default router;