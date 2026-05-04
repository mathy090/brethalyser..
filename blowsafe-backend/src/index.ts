/**
 * blowsafe-backend/src/index.ts
 * BlowSafe API server entry point.
 */

import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import fs from "fs";

// Import DB connection function
import { connectDB } from "./config/db"; // <--- MAKE SURE THIS FILE EXISTS

import { env } from "./config/env";
import { initSocket } from "./config/socket";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";

const app = express();
const httpServer = createServer(app);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));
// Do NOT parse multipart here — multer in upload.ts handles multipart/form-data
app.use(express.json({ limit: "10mb" }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth",  authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api",       uploadRoutes);

// ─── Health ──────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", app: "BlowSafe", version: "1.0.0" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─── Local upload dir (dev only) ─────────────────────────────────────────────
if (process.env.NODE_ENV === "development") {
  const uploadsDir = path.join(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadsDir));
  console.log(`📁 Serving local uploads from: ${uploadsDir}`);
}

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: "Endpoint not found", path: _req.path, method: _req.method });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Error:", err);

  if (err.name === "MulterError") {
    return res.status(400).json({ error: "File upload error", details: err.message });
  }
  if (err.message === "Only image files allowed") {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function startServer() {
  try {
    // 1. Connect to Database FIRST
    console.log("🔄 Connecting to MongoDB...");
    await connectDB(); 
    console.log("✅ MongoDB Connected");

    console.log("✅ Supabase client ready (lazy-loaded)");

    // 2. Initialize Socket
    initSocket(httpServer);
    console.log("✅ Socket initialized");

    // 3. Prepare Local Uploads (Dev Only)
    if (process.env.NODE_ENV === "development") {
      const uploadPath = path.join(process.cwd(), "uploads", "driver-photos");
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      console.log(`📁 Local upload directory ready: ${uploadPath}`);
    }

    // 4. Start Server
    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${env.PORT}`);
      console.log(`🌐 ${process.env.API_BASE_URL ?? `http://0.0.0.0:${env.PORT}`}`);
      console.log(`☁️  Supabase: ${process.env.SUPABASE_URL ? "configured" : "NOT CONFIGURED"}`);
    });
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

// ─── Process error guards only (no SIGTERM handler) ───────────────────────────
process.on("uncaughtException",   (err)    => console.error("❌ Uncaught Exception:", err));
process.on("unhandledRejection",  (reason) => console.error("❌ Unhandled Rejection:", reason));

startServer();

export { app, httpServer };
