/**
 * src/routes/admin.ts
 *
 * Admin-only endpoints for BlowSafe officer management.
 *
 * GET   /api/admin/officers               — list all officers (admin+)
 * PATCH /api/admin/officers/:id/role      — promote / demote (superadmin only)
 * PATCH /api/admin/officers/:id/status    — approve / reject (admin+)
 * POST  /api/admin/trigger-role-update    — Atlas trigger webhook (secret-gated)
 */

import { Router, type Response } from "express";

import { verifyJWT, requireRole, type AuthRequest } from "../middleware/verifyToken";
import { Officer }                                  from "../models/Officer";
import { emitRoleUpdate }                           from "../config/socket";
import { Errors }                                   from "../utils/errors";
import { env }                                      from "../config/env";

const router = Router();

const VALID_ROLES   = ["officer", "admin", "superadmin"] as const;
const VALID_STATUSES = ["pending", "approved", "rejected"] as const;

type OfficerRole   = (typeof VALID_ROLES)[number];
type OfficerStatus = (typeof VALID_STATUSES)[number];

// ─── GET /api/admin/officers ─────────────────────────────────────────────────

router.get(
  "/officers",
  verifyJWT,
  requireRole("admin", "superadmin"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      // Never expose the internal Firebase UID to clients.
      const officers = await Officer.find({}, { firebaseUid: 0 }).lean();
      res.status(200).json(officers);
    } catch (err) {
      Errors.internal(res, "GET /officers", err);
    }
  }
);

// ─── PATCH /api/admin/officers/:id/role ─────────────────────────────────────

router.patch(
  "/officers/:id/role",
  verifyJWT,
  requireRole("superadmin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { role } = req.body as { role?: string };

      if (!role || !VALID_ROLES.includes(role as OfficerRole)) {
        Errors.invalidField(res, "role", `must be one of: ${VALID_ROLES.join(", ")}`);
        return;
      }

      const officer = await Officer.findByIdAndUpdate(
        req.params["id"],
        { role },
        { new: true }
      );

      if (!officer) {
        Errors.officerNotFound(res);
        return;
      }

      emitRoleUpdate(officer.firebaseUid, officer.role, officer.status);
      res.status(200).json({ message: "Role updated.", officer });
    } catch (err) {
      Errors.internal(res, "PATCH /officers/:id/role", err);
    }
  }
);

// ─── PATCH /api/admin/officers/:id/status ────────────────────────────────────

router.patch(
  "/officers/:id/status",
  verifyJWT,
  requireRole("admin", "superadmin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { status } = req.body as { status?: string };

      if (!status || !VALID_STATUSES.includes(status as OfficerStatus)) {
        Errors.invalidField(
          res,
          "status",
          `must be one of: ${VALID_STATUSES.join(", ")}`
        );
        return;
      }

      const officer = await Officer.findByIdAndUpdate(
        req.params["id"],
        { status, approvedBy: req.officerId },
        { new: true }
      );

      if (!officer) {
        Errors.officerNotFound(res);
        return;
      }

      emitRoleUpdate(officer.firebaseUid, officer.role, officer.status);
      res.status(200).json({ message: "Status updated.", officer });
    } catch (err) {
      Errors.internal(res, "PATCH /officers/:id/status", err);
    }
  }
);

// ─── POST /api/admin/trigger-role-update ─────────────────────────────────────
// Called by a MongoDB Atlas trigger (or admin webhook) when a role changes
// outside of the API, e.g. a manual Atlas edit.

router.post(
  "/trigger-role-update",
  (req: AuthRequest, res: Response): void => {
    const secret = req.headers["x-trigger-secret"];

    // Guard: if TRIGGER_SECRET is not configured, the endpoint is effectively
    // disabled — reject every call rather than allowing unauthenticated access.
    if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
      Errors.insufficientPermissions(res);
      return;
    }

    const { firebaseUid, role, status } = req.body as {
      firebaseUid?: string;
      role?:        string;
      status?:      string;
    };

    const missing: string[] = [];
    if (!firebaseUid) missing.push("firebaseUid");
    if (!role)        missing.push("role");
    if (!status)      missing.push("status");

    if (missing.length > 0) {
      Errors.missingFields(res, missing);
      return;
    }

    emitRoleUpdate(firebaseUid!, role!, status!);
    res.status(200).json({ message: "Role update emitted." });
  }
);

export default router;