/**
 * src/config/mongo.ts
 *
 * MongoDB connection via Mongoose.
 * URI comes from the validated env config.
 */

import mongoose from "mongoose";

import { env } from "./env";

export const connectMongo = async (): Promise<void> => {
  try {
    await mongoose.connect(env.MONGO_URI);
    console.log("[BlowSafe] ✅  MongoDB connected");
  } catch (err) {
    console.error("[BlowSafe] ❌  MongoDB connection failed:", err);
    process.exit(1);
  }
};