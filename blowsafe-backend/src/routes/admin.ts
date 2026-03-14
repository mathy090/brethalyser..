import { Router, type Response } from "express";
import { Officer } from "../models/Officer";
import { verifyJWT, type AuthRequest } from "../middleware/verifyToken";
import { emitRoleUpdate } from "../config/socket";

const router = Router();

// Only superadmin can access
const requireSuperAdmin = async (req: AuthRequest, res: Response, next: any): Promise<void> => {
  const officer = await Officer.findOne({ firebaseUid: req.uid });
  if (!officer || officer.role !== "superadmin") {
    res.status(403).json({ message: "Superadmin access required" });
    return;
  }
  next();
};

// GET /api/admin/officers — list all officers
router.get("/officers", verifyJWT, requireSuperAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const officers = await Officer.find({}, { firebaseUid: 0 });
    res.status(200).json({ officers });
  } catch {
    res.status(500).json({ message: "Failed to fetch officers" });
  }
});

// PATCH /api/admin/promote — promote to admin, instant push to device
router.patch("/promote", verifyJWT, requireSuperAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { officerId } = req.body;
    const officer = await Officer.findOneAndUpdate(
      { officerId },
      { role: "admin" },
      { new: true }
    );

    if (!officer) {
      res.status(404).json({ message: "Officer not found" });
      return;
    }

    // Push to officer's device — tabs appear instantly
    emitRoleUpdate(officer.firebaseUid, "admin");

    res.status(200).json({ message: "Officer promoted to admin", officer });
  } catch {
    res.status(500).json({ message: "Promotion failed" });
  }
});

// PATCH /api/admin/demote — remove admin, instant push to device
router.patch("/demote", verifyJWT, requireSuperAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { officerId } = req.body;
    const officer = await Officer.findOneAndUpdate(
      { officerId },
      { role: "officer" },
      { new: true }
    );

    if (!officer) {
      res.status(404).json({ message: "Officer not found" });
      return;
    }

    // Push to officer's device — tabs disappear instantly
    emitRoleUpdate(officer.firebaseUid, "officer");

    res.status(200).json({ message: "Admin role removed", officer });
  } catch {
    res.status(500).json({ message: "Demotion failed" });
  }
});

export default router;