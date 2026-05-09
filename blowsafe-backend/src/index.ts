/**
 * blowsafe-backend/src/index.ts
 * BlowSafe API server entry point
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";

import { env } from "./config/env";
import { connectMongo } from "./config/mongo";
import { initFirebaseAdmin } from "./config/firebase";
import { initSocket } from "./config/socket";
import { blockCommercialVPN } from "./middleware/vpnBlocker"; // ← Your VPN blocker

// Routes
import registerRoutes from "./routes/register"; // ← NEW: Public signup
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";
import recordsRoutes from "./routes/records";

const app = express();
const httpServer = createServer(app);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ 
  origin: env.CORS_ORIGIN || "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── 🔐 Commercial VPN Blocker (Runs on EVERY request) ───────────────────────
app.use(blockCommercialVPN);

// ─── Rate Limiting for Public Routes ────────────────────────────────────────
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 registration attempts per window
  message: { success: false, error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ──────────────────────────────────────────────────────────────────
// PUBLIC ROUTES (no auth required)
app.use("/api/auth/register", publicLimiter, registerRoutes); // ← NEW: Mounted FIRST

// PROTECTED ROUTES (require JWT verification via verifyJWT middleware)
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);
app.use("/api", recordsRoutes);

// ─── Health Checks ──────────────────────────────────────────────────────────
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

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: "Validation Error", errors: err.errors });
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
    console.log("🔄 Connecting to MongoDB...");
    await connectMongo();
    console.log("✅ MongoDB connected successfully");

    console.log("🔄 Initializing Firebase Admin SDK...");
    await initFirebaseAdmin();
    console.log("✅ Firebase Admin initialized");

    initSocket(httpServer);
    console.log("✅ Socket.IO initialized");

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

// ─── Process Handlers ────────────────────────────────────────────────────────
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received. Shutting down gracefully...");
  httpServer.close(() => { console.log("✅ Server closed."); process.exit(0); });
});

startServer();

export { app, httpServer };