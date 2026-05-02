/**
 * src/index.ts
 * BlowSafe API server entry point
 */

import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import fs from "fs";

import { env } from "./config/env";
import { connectMongo } from "./config/mongo";
import { initSocket } from "./config/socket";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload"; // 🔧 Import upload route

const app = express();
const httpServer = createServer(app);

// ────────────────────────────────
// Middleware
// ────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));

// 🔥 IMPORTANT: do NOT parse multipart requests here
app.use(express.json({ limit: "10mb" }));

// ────────────────────────────────
// Routes
// ────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes); // 🔧 Register upload route → /api/upload

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
// Serve uploads (PRODUCTION + DEV)
// ────────────────────────────────
const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsDir));

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
    await connectMongo();
    console.log("✅ MongoDB connected");

    initSocket(httpServer);
    console.log("✅ Socket initialized");

    // Ensure upload directory exists
    const uploadPath = path.join(process.cwd(), "uploads", "driver-photos");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${env.PORT}`);
      console.log(`🌐 ${env.API_BASE_URL}`);
    });

  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

// ────────────────────────────────
// Crash debugging (VERY IMPORTANT)
// ────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received (Render restart)");
});

// Start app
startServer();

export { app, httpServer };