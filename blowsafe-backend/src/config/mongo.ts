/**
 * src/config/mongo.ts
 *
 * MongoDB connection via Mongoose.
 * Exports: connectMongo(), getDb(), getMongoose()
 */

import mongoose from "mongoose";
import { env } from "./env";

// Store connection promise to avoid reconnecting
let mongooseConnection: typeof mongoose | null = null;
let connectPromise: Promise<typeof mongoose> | null = null;

export const connectMongo = async (): Promise<void> => {
  if (mongooseConnection) {
    console.log("[BlowSafe] ✅ MongoDB already connected");
    return;
  }

  if (connectPromise) {
    await connectPromise;
    return;
  }

  connectPromise = (async () => {
    try {
      mongooseConnection = await mongoose.connect(env.MONGO_URI);
      console.log("[BlowSafe] ✅ MongoDB connected");
      return mongooseConnection;
    } catch (err) {
      console.error("[BlowSafe] ❌ MongoDB connection failed:", err);
      connectPromise = null; // Reset to allow retry
      process.exit(1);
    }
  })();

  await connectPromise;
};

/**
 * Get the native MongoDB Db instance from Mongoose connection.
 * Use this for raw queries when needed.
 */
export const getDb = () => {
  if (!mongooseConnection?.connection) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return mongooseConnection.connection.db;
};

/**
 * Get the Mongoose instance for model-based operations.
 */
export const getMongoose = () => {
  if (!mongooseConnection) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return mongooseConnection;
};

export default { connectMongo, getDb, getMongoose };