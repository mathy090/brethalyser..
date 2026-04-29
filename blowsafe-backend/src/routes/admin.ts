// ─── POST /api/admin/officers/import ─────────────────────────────────────────
// Open endpoint (no auth) - imports minimal officer data: officerId + email
// Creates new officers with default: role="officer", status="pending"
// If officer exists, updates nothing (idempotent) - safe to retry

router.post(
  "/officers/import",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { officers } = req.body as { officers?: Array<{ officerId: string; email: string }> };

      if (!officers || !Array.isArray(officers) || officers.length === 0) {
        Errors.invalidField(res, "officers", "must be a non-empty array of { officerId, email }");
        return;
      }

      // Validate input format
      const invalid = officers.filter(o => !o.officerId || !o.email);
      if (invalid.length > 0) {
        Errors.invalidField(res, "officers", "each entry must have officerId and email");
        return;
      }

      // Bulk upsert: create if new, skip if exists (no overwrites)
      const operations = officers.map(officer => ({
        updateOne: {
          filter: { officerId: officer.officerId },
          update: {
            $setOnInsert: {
              officerId: officer.officerId,
              email: officer.email.toLowerCase(),
              firebaseUid: `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`, // placeholder
              role: "officer",
              status: "pending",
              approvedBy: null,
              createdAt: new Date()
            }
          },
          upsert: true
        }
      }));

      const result = await Officer.bulkWrite(operations, { ordered: false });

      res.status(201).json({
        message: "Import complete",
        inserted: result.upsertedCount,
        skipped: officers.length - result.upsertedCount
      });

    } catch (err) {
      Errors.internal(res, "POST /officers/import", err);
    }
  }
);okok