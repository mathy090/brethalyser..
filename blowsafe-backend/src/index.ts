/**
 * src/index.ts
 * BlowSafe API server entry point
 * Uses Supabase for Storage + Database (no MongoDB)
 */

import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import fs from "fs";

import { env } from "./config/env";
// 🔥 REMOVED: import { connectMongo } from "./config/mongo"; // No longer needed
import { initSocket } from "./config/socket";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload"; // ✅ Uses Supabase now

const app = express();
const httpServer = createServer(app);

// ────────────────────────────────
// Middleware
// ────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));

// 🔥 IMPORTANT: do NOT parse multipart requests here
// Multer in upload.ts handles multipart/form-data
app.use(express.json({ limit: "10mb" }));

// ────────────────────────────────
// Routes
// ────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes); // ✅ → /api/upload (Supabase-backed)

// Health
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    app: "BlowSafe",
    version: "1.0.0",
    environment: env.NODE_ENV,
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ────────────────────────────────
// Serve uploads (DEV ONLY - Supabase Storage for PROD)
// ────────────────────────────────
if (env.NODE_ENV === "development") {
  const uploadsDir = path.join(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadsDir));
  console.log(`📁 Serving local uploads from: ${uploadsDir}`);
}

// ────────────────────────────────
// 404 handler
// ────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    message: "Endpoint not found",
    path: _req.path,
    method: _req.method,
  });
});

// ────────────────────────────────
// Error handler
// ────────────────────────────────
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Error:", err);

  // 🔥 Handle multer errors properly
  if (err.name === "MulterError") {
    return res.status(400).json({
      error: "File upload error",
      details: err.message,
    });
  }

  if (err.message === "Only image files allowed") {
    return res.status(400).json({ error: err.message });
  }

  // Supabase-specific errors
  if (err.message?.includes("SUPABASE_URL") || err.message?.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    return res.status(500).json({
      error: "Server configuration error",
      details: env.NODE_ENV === "development" ? err.message : undefined,
    });
  }

  res.status(500).json({
    error: env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
});

// ────────────────────────────────
// Start server
// ────────────────────────────────
async function startServer() {
  try {
    // 🔥 REMOVED: await connectMongo(); // No MongoDB connection needed

    // ✅ Supabase client is lazy-loaded in upload.ts, no global init needed
    console.log("✅ Supabase client ready (lazy-loaded)");

    initSocket(httpServer);
    console.log("✅ Socket initialized");

    // 🔥 REMOVED: Local upload directory creation (Supabase Storage handles this)
    // Only needed if you want local fallback in dev
    if (env.NODE_ENV === "development") {
      const uploadPath = path.join(process.cwd(), "uploads", "driver-photos");
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      console.log(`📁 Local upload directory ready: ${uploadPath}`);
    }

    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${env.PORT}`);
      console.log(`🌐 ${env.API_BASE_URL}`);
      console.log(`☁️  Supabase: ${process.env.SUPABASE_URL ? 'configured' : 'NOT CONFIGURED'}`);
    });

  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

// ────────────────────────────────
// Crash debugging & Graceful Shutdown
// ────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

// 🔥 Graceful shutdown for Render deploys
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received - starting graceful shutdown...");
  httpServer.close(() => {
    console.log("✅ HTTP server closed");
    process.exit(0);
  });
  // Force exit after 30s if connections don't close
  setTimeout(() => {
    console.error("❌ Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
});

// Start app
startServer();

export { app, httpServer };