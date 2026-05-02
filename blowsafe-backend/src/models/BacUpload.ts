/**
 * src/models/BacUpload.ts
 * MongoDB schema for driver + BAC reading uploads
 */
import mongoose, { Schema, Document } from "mongoose";

export interface IDriver extends Document {
  surname: string;
  firstName: string;
  dateOfBirth: string; // ISO date string
  gender: "M" | "F" | "";
  idNumber: string;
  licenceNumber: string;
  licenceCode: string;
  issueDate: string;
  expiryDate: string;
  photoUrl: string; // URL or path to stored photo
  createdAt: Date;
}

export interface IBacReading extends Document {
  driver: mongoose.Types.ObjectId; // Reference to Driver
  bacValue: number; // e.g., 0.08 for 0.08%
  overLimit: boolean;
  fineAmount: number;
  recordedAt: Date; // When the test was performed
  createdAt: Date;
}

const DriverSchema = new Schema(
  {
    surname: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    dateOfBirth: { type: String, required: true },
    gender: { type: String, enum: ["M", "F", ""], required: true },
    idNumber: { type: String, required: true, unique: true, trim: true },
    licenceNumber: { type: String, required: true, unique: true, trim: true },
    licenceCode: { type: String, required: true, trim: true },
    issueDate: { type: String, required: true },
    expiryDate: { type: String, required: true },
    photoUrl: { type: String, required: true },
  },
  { timestamps: true }
);

const BacReadingSchema = new Schema(
  {
    driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    bacValue: { type: Number, required: true, min: 0, max: 1 },
    overLimit: { type: Boolean, required: true },
    fineAmount: { type: Number, required: true, min: 0 },
    recordedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Prevent model overwrite on hot reload
export const Driver = mongoose.models.Driver || mongoose.model<IDriver>("Driver", DriverSchema);
export const BacReading = mongoose.models.BacReading || mongoose.model<IBacReading>("BacReading", BacReadingSchema);