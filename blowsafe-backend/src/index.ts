/**
 * blowsafe-backend/src/index.ts
 *
 * Entry point for the Express + Socket.IO + Redis backend.
 * - Starts HTTP server immediately (non-blocking Redis init)
 * - Graceful shutdown for Redis + HTTP + Socket.IO
 * - Integrates existing middleware, routes, and auth
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
import { initRedis, closeRedis } from "./config/redis";
import { createSocketServer, closeSocketServer } from "./sockets/server";
import { blockCommercialVPN } from "./middleware/vpnBlocker";

// ── Routes ──────────────────────────────────────────────────────────────────
import registerRoutes from "./routes/register";
import loginRoutes from "./auth/login";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";
import recordsRoutes from "./routes/records";

// ── App setup ───────────────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

app.set("trust proxy", true);
app.disable("x-powered-by");

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: false, // Allow images/fonts from CDN
    contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
  })
);
app.use(compression());

// CORS
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (env.NODE_ENV === "production") {
        const allowed = (env.CORS_ORIGIN ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        return allowed.includes(origin)
          ? cb(null, true)
          : cb(new Error("CORS blocked"));
      }
      return cb(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  })
);

// Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// VPN blocker middleware
app.use(blockCommercialVPN);

// ── Rate limiters ───────────────────────────────────────────────────────────
const keyGenerator = (req: express.Request) =>
  (req.headers["x-forwarded-for"] as string ?? req.ip ?? "unknown")
    .split(",")[0]
    .trim();

const publicLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  trustProxy: true,
  keyGenerator,
  handler: (_req, res) =>
    res.status(429).json({ success: false, code: "RATE_LIMITED" }),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  trustProxy: true,
  keyGenerator,
  handler: (_req, res) =>
    res.status(429).json({ success: false, code: "LOGIN_RATE_LIMITED" }),
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth/register", publicLimiter, registerRoutes);
app.use("/api/auth/login", loginLimiter, loginRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);
app.use("/api", recordsRoutes);

// Health checks
app.get("/", (_req, res) =>
  res.json({ status: "ok", app: "BlowSafe", env: env.NODE_ENV })
);
app.get("/health", (_req, res) =>
  res.json({ status: "ok", uptime: process.uptime(), timestamp: Date.now() })
);

// 404 handler
app.use((_req, res) =>
  res.status(404).json({ code: "NOT_FOUND", message: "Route not found" })
);

// Global error handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (res.headersSent) return next(err);
    console.error("[Unhandled Error]", err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: env.NODE_ENV === "production" ? "Server error" : err.message,
    });
  }
);

// ── Startup ─────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  // Initialize core services
  await connectMongo();
  await initFirebaseAdmin();

  // 🚀 Start HTTP server IMMEDIATELY (critical for Render port detection)
  httpServer.listen(env.PORT, "0.0.0.0", () => {
    console.log(
      `[BlowSafe] 🚀 HTTP server listening on :${env.PORT} (${env.NODE_ENV})`
    );
  });

  // 🔁 Initialize Redis + Socket.IO asynchronously (non-blocking)
  try {
    const { pub, sub } = await initRedis();
    createSocketServer(httpServer, pub, sub);
    console.log("[BlowSafe] ✅ Real-time layer initialized");
  } catch (err) {
    console.error(
      "[BlowSafe] ⚠️  Real-time layer failed (continuing without scaling):",
      err instanceof Error ? err.message : String(err)
    );
    // Fallback: Socket.IO in-memory mode
    createSocketServer(httpServer, null, null);
  }
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[BlowSafe] 🛑 ${signal} received — initiating graceful shutdown`);

  // Stop accepting new connections
  httpServer.close(async () => {
    console.log("[BlowSafe] 🔌 HTTP server closed");

    // Close Socket.IO
    await closeSocketServer();

    // Close Redis
    await closeRedis();

    console.log("[BlowSafe] ✅ Shutdown complete — goodbye");
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    console.error("[BlowSafe] ⚠️  Force exit after 10s timeout");
    process.exit(1);
  }, 10_000);
}

// ── Signal handlers ─────────────────────────────────────────────────────────
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  console.error("[BlowSafe] 💥 Uncaught Exception:", err);
  void shutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason) => {
  console.error("[BlowSafe] 💥 Unhandled Rejection:", reason);
  // Don't exit on unhandled rejections — let the app continue
});

// ── Boot ────────────────────────────────────────────────────────────────────
start().catch((err) => {
  console.error("[BlowSafe] ❌ Startup failed:", err);
  process.exit(1);
});

export { app, httpServer };