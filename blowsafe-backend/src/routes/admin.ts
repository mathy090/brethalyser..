import { Router, type Response } from "express";
import { verifyJWT, requireRole, type AuthRequest } from "../middleware/verifyToken";
import { Officer } from "../models/Officer";
import { emitRoleUpdate } from "../config/socket";

const router = Router();

// GET /api/admin/officers
router.get("/officers", verifyJWT, requireRole("admin", "superadmin"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const officers = await Officer.find({}, { firebaseUid: 0 });
    res.status(200).json(officers);
  } catch {
    res.status(500).json({ message: "Failed to fetch officers" });
  }
});

// PATCH /api/admin/officers/:id/role — promote or demote
router.patch("/officers/:id/role", verifyJWT, requireRole("superadmin"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { role } = req.body;

    if (!["officer", "admin", "superadmin"].includes(role)) {
      res.status(400).json({ message: "Invalid role" });
      return;
    }

    const officer = await Officer.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );

    if (!officer) {
      res.status(404).json({ message: "Officer not found" });
      return;
    }

    // Push role change instantly to officer's app via WebSocket
    emitRoleUpdate(officer.firebaseUid, officer.role, officer.status);

    res.status(200).json({ message: "Role updated", officer });
  } catch {
    res.status(500).json({ message: "Failed to update role" });
  }
});

// PATCH /api/admin/officers/:id/status
router.patch("/officers/:id/status", verifyJWT, requireRole("admin", "superadmin"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      res.status(400).json({ message: "Invalid status" });
      return;
    }

    const officer = await Officer.findByIdAndUpdate(
      req.params.id,
      { status, approvedBy: req.officerId },
      { new: true }
    );

    if (!officer) {
      res.status(404).json({ message: "Officer not found" });
      return;
    }

    emitRoleUpdate(officer.firebaseUid, officer.role, officer.status);

    res.status(200).json({ message: "Status updated", officer });
  } catch {
    res.status(500).json({ message: "Failed to update status" });
  }
});

export default router;