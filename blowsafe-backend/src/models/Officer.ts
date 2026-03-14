import mongoose from "mongoose";

const OfficerSchema = new mongoose.Schema({
  officerId:   { type: String, required: true, unique: true },
  email:       { type: String, required: true, unique: true },
  firebaseUid: { type: String, required: true, unique: true },
  role:        { type: String, enum: ["officer", "admin", "superadmin"], default: "officer" },
  status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  approvedBy:  { type: String, default: null },
  createdAt:   { type: Date, default: Date.now },
});

export const Officer = mongoose.model("Officer", OfficerSchema);