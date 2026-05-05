/**
 * blowsafe-backend/src/index.ts
 * BlowSafe API server entry point
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";

import { env } from "./config/env";
import { connectMongo } from "./config/mongo";
import { initSocket } from "./config/socket";

// Routes
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";   // 👈 Upload route (public – no auth required)

const app = express();
const httpServer = createServer(app);

// ─── Middleware ──────────────────────────────────────────────────────────────

// Security headers
app.use(helmet());

// Compression for response bodies
app.use(compression());

// CORS Configuration
app.use(cors({ 
  origin: "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Body Parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);                // 👈 POST /api/upload (public)

// ─── Health Checks ───────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ 
    status: "ok", 
    app: "BlowSafe", 
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (_req, res) => {
  res.json({ 
    status: "ok", 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    message: "Endpoint not found",
    code: "NOT_FOUND",
    path: _req.path
  });
});

// ─── Global Error Handler ────────────────────────────────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("❌ Unhandled error:", err);

  const isProduction = env.NODE_ENV === "production";

  // Handle Mongoose Validation Errors specifically if needed
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: "Validation Error",
      errors: err.errors
    });
  }

  res.status(500).json({
    message: isProduction ? "Internal server error" : err.message,
    code: "INTERNAL_ERROR",
    ...( !isProduction && { stack: err.stack }),
  });
});

// ─── Server Startup ──────────────────────────────────────────────────────────

async function startServer() {
  try {
    // 1. Connect to MongoDB
    console.log("🔄 Connecting to MongoDB...");
    await connectMongo();
    console.log("✅ MongoDB connected successfully");

    // 2. Initialize Socket.IO
    initSocket(httpServer);
    console.log("✅ Socket.IO initialized");

    // 3. Start HTTP Server
    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`🚀 [BlowSafe] Server running on port ${env.PORT}`);
      console.log(`📡 Environment: ${env.NODE_ENV}`);
      console.log(`🔗 API Base: ${process.env.API_BASE_URL || `http://localhost:${env.PORT}`}`);
    });

  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// ─── Process Event Handlers ──────────────────────────────────────────────────

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received. Shutting down gracefully...");
  httpServer.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
});

// Start the application
startServer();

export { app, httpServer };