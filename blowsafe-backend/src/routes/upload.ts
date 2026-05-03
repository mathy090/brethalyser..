/**
 * src/routes/upload.ts
 * Split upload routes: Photo first, Data second
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
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");

  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { apiKey: key, Authorization: `Bearer ${key}` } },
  });
  return _supabase;
}

// ─── Multer (Photo only) ────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
  },
});

// ─── Route 1: POST /api/upload/photo ────────────────────────────────────────
// Handles ONLY the image upload to Supabase Storage
router.post("/upload/photo", upload.single("photo"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Photo is required" });

    const supabase = getSupabase();
    const ext = file.mimetype.split("/")[1] ?? "jpg";
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const filePath = `driver-photos/${unique}-driver.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("driver-photos")
      .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) throw uploadError;

    const supabaseUrl = process.env.SUPABASE_URL;
    const photoUrl = `${supabaseUrl}/storage/v1/object/public/driver-photos/${filePath}`;

    res.json({ photoUrl });
  } catch (err: any) {
    console.error("❌ Photo upload error:", err);
    res.status(500).json({ error: "Photo upload failed", details: err.message });
  }
});

// ─── Route 2: POST /api/upload/data ─────────────────────────────────────────
// Handles ONLY the JSON text + inserts into Supabase DB
router.post("/upload/data", async (req: Request, res: Response) => {
  try {
    const { driverData, bacData, photoUrl } = req.body;
    if (!driverData || !bacData || !photoUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedDriver = JSON.parse(driverData);
    const parsedBac = JSON.parse(bacData);
    const supabase = getSupabase();

    // Insert Driver
    const {  driver, error: driverError } = await supabase.from("drivers").insert({
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
    }).select().single();

    if (driverError) throw driverError;

    // Insert BAC Reading
    const { data: reading, error: readingError } = await supabase.from("bac_readings").insert({
      driver_id: driver.id,
      bac_value: Number(parsedBac.bac),
      over_limit: parsedBac.overLimit,
      fine_amount: Number(parsedBac.fine),
      recorded_at: new Date(parsedBac.timestamp).toISOString(),
    }).select().single();

    if (readingError) throw readingError;

    res.status(201).json({ success: true, message: "Upload complete",  { driverId: driver.id, readingId: reading.id } });
  } catch (err: any) {
    console.error("❌ Data upload error:", err);
    res.status(500).json({ error: "Data upload failed", details: err.message });
  }
});

export default router;/**
 * src/routes/upload.ts
 * Split upload routes: Photo first, Data second
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
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");

  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { apiKey: key, Authorization: `Bearer ${key}` } },
  });
  return _supabase;
}

// ─── Multer (Photo only) ────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
  },
});

// ─── Route 1: POST /api/upload/photo ────────────────────────────────────────
// Handles ONLY the image upload to Supabase Storage
router.post("/upload/photo", upload.single("photo"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Photo is required" });

    const supabase = getSupabase();
    const ext = file.mimetype.split("/")[1] ?? "jpg";
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const filePath = `driver-photos/${unique}-driver.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("driver-photos")
      .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) throw uploadError;

    const supabaseUrl = process.env.SUPABASE_URL;
    const photoUrl = `${supabaseUrl}/storage/v1/object/public/driver-photos/${filePath}`;

    res.json({ photoUrl });
  } catch (err: any) {
    console.error("❌ Photo upload error:", err);
    res.status(500).json({ error: "Photo upload failed", details: err.message });
  }
});

// ─── Route 2: POST /api/upload/data ─────────────────────────────────────────
// Handles ONLY the JSON text + inserts into Supabase DB
router.post("/upload/data", async (req: Request, res: Response) => {
  try {
    const { driverData, bacData, photoUrl } = req.body;
    if (!driverData || !bacData || !photoUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedDriver = JSON.parse(driverData);
    const parsedBac = JSON.parse(bacData);
    const supabase = getSupabase();

    // Insert Driver
    const {  driver, error: driverError } = await supabase.from("drivers").insert({
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
    }).select().single();

    if (driverError) throw driverError;

    // Insert BAC Reading
    const { data: reading, error: readingError } = await supabase.from("bac_readings").insert({
      driver_id: driver.id,
      bac_value: Number(parsedBac.bac),
      over_limit: parsedBac.overLimit,
      fine_amount: Number(parsedBac.fine),
      recorded_at: new Date(parsedBac.timestamp).toISOString(),
    }).select().single();

    if (readingError) throw readingError;

    res.status(201).json({ success: true, message: "Upload complete",  { driverId: driver.id, readingId: reading.id } });
  } catch (err: any) {
    console.error("❌ Data upload error:", err);
    res.status(500).json({ error: "Data upload failed", details: err.message });
  }
});

export default router;