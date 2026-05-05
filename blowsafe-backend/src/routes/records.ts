// blowsafe-backend/src/routes/records.ts
// Public route (or protect with auth if needed) to read uploaded records.

import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// Reuse the same Supabase client instantiation pattern as upload.ts
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

router.get("/records", async (_req, res) => {
  try {
    const supabase = getSupabase();

    // Fetch drivers with their latest BAC reading
    const { data, error } = await supabase
      .from("drivers")
      .select(`
        id,
        first_name,
        surname,
        id_number,
        licence_number,
        date_of_birth,
        gender,
        licence_code,
        issue_date,
        expiry_date,
        photo_url,
        bac_readings ( bac_value, over_limit, fine_amount, recorded_at, officer_id )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Flatten nested bac_readings
    const records = (data ?? []).map((driver: any) => {
      const latestReading = driver.bac_readings?.[0] ?? {};
      return {
        id: driver.id,
        first_name: driver.first_name,
        surname: driver.surname,
        id_number: driver.id_number,
        licence_number: driver.licence_number,
        date_of_birth: driver.date_of_birth,
        gender: driver.gender,
        licence_code: driver.licence_code,
        issue_date: driver.issue_date,
        expiry_date: driver.expiry_date,
        photo_url: driver.photo_url,
        bac_value: latestReading.bac_value,
        fine_amount: latestReading.fine_amount,
        over_limit: latestReading.over_limit,
        recorded_at: latestReading.recorded_at,
        officer_id: latestReading.officer_id,
      };
    });

    res.json({ records });
  } catch (err: any) {
    console.error("❌ Records fetch error:", err);
    res.status(500).json({ message: "Failed to fetch records" });
  }
});

export default router;