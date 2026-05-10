/**
 * blowsafe-backend/src/index.ts
 * BlowSafe API server entry point (ADVANCED LOGGING VERSION)
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
import { blockCommercialVPN } from "./middleware/vpnBlocker";

// Routes
import registerRoutes from "./routes/register";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";
import recordsRoutes from "./routes/records";

const app = express();
const httpServer = createServer(app);

// ─────────────────────────────────────────────
// BOOT LOG
// ─────────────────────────────────────────────
console.log("\n========================================");
console.log("🚀 BOOTING BLOWSAFE BACKEND");
console.log("🌍 Environment:", env.NODE_ENV);
console.log("🌐 Port:", env.PORT);
console.log("⏰ Started:", new Date().toISOString());
console.log("========================================\n");

// ─────────────────────────────────────────────
// SECURITY
// ─────────────────────────────────────────────
app.set("trust proxy", 1);
app.disable("x-powered-by");

console.log("🛡️ Loading security middleware...");

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(compression());

console.log("✅ Security middleware loaded");

// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────
console.log("🌍 Configuring CORS...");

app.use(
  cors({
    origin:
      env.NODE_ENV === "production"
        ? env.CORS_ORIGIN
        : "*",

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

console.log("✅ CORS ready");

// ─────────────────────────────────────────────
// BODY PARSER
// ─────────────────────────────────────────────
console.log("📦 Initializing body parser...");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

console.log("✅ Body parser ready");

// ─────────────────────────────────────────────
// REQUEST LOGGER
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  const started = Date.now();

  const ip =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.ip ||
    req.socket.remoteAddress ||
    "unknown";

  console.log("\n========================================");
  console.log("📥 Incoming Request");
  console.log("Method :", req.method);
  console.log("Path   :", req.originalUrl);
  console.log("IP     :", ip);
  console.log("Time   :", new Date().toISOString());

  if (
    req.body &&
    Object.keys(req.body).length > 0
  ) {
    console.log("Body   :", {
      ...req.body,
      password: req.body.password
        ? "********"
        : undefined,
    });
  }

  res.on("finish", () => {
    const duration = Date.now() - started;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📤 Response Sent");
    console.log("Status :", res.statusCode);
    console.log("Time   :", `${duration}ms`);
    console.log("========================================\n");
  });

  next();
});

// ─────────────────────────────────────────────
// VPN BLOCKER
// ─────────────────────────────────────────────
console.log("🔐 Loading VPN blocker...");

app.use(blockCommercialVPN);

console.log("✅ VPN blocker active");

// ─────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────
console.log("🚦 Configuring rate limiter...");

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req) => {
    return (
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"] ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown"
    ).toString();
  },

  handler: (req, res) => {
    console.log("🚫 RATE LIMIT EXCEEDED");
    console.log("IP:", req.ip);

    return res.status(429).json({
      success: false,
      code: "RATE_LIMITED",
      error: "Too many requests",
    });
  },
});

console.log("✅ Rate limiter ready");

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────
console.log("🛣️ Loading routes...");

app.use(
  "/api/auth/register",
  publicLimiter,
  registerRoutes
);

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);
app.use("/api", recordsRoutes);

console.log("✅ Routes loaded");

// ─────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────
app.get("/", (_req, res) => {
  console.log("🏠 Root endpoint hit");

  res.json({
    status: "ok",
    app: "BlowSafe",
    version: "1.0.0",
  });
});

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  console.log("💓 Health check hit");

  res.json({
    status: "ok",
    uptime: process.uptime(),
  });
});

// ─────────────────────────────────────────────
// 404
// ─────────────────────────────────────────────
app.use((req, res) => {
  console.log("❌ 404 Endpoint:", req.originalUrl);

  res.status(404).json({
    success: false,
    code: "NOT_FOUND",
    error: "Endpoint not found",
    path: req.path,
  });
});

// ─────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────
app.use((
  err: any,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {

  if (res.headersSent) {
    return next(err);
  }

  console.log("\n========================================");
  console.log("❌ GLOBAL ERROR");
  console.log("Path   :", req.originalUrl);
  console.log("Method :", req.method);
  console.log("Code   :", err.code);
  console.log("Message:", err.message);

  if (err.stack) {
    console.log("Stack:");
    console.log(err.stack);
  }

  console.log("========================================\n");

  // Mongo duplicate
  if (err.code === 11000) {

    const field = Object.keys(
      err.keyPattern || {}
    )[0];

    console.log("🚫 Mongo Duplicate:", field);

    return res.status(409).json({
      success: false,
      code:
        field === "officerId"
          ? "OFFICER_ID_EXISTS"
          : "EMAIL_EXISTS",

      error:
        field === "officerId"
          ? "Officer ID already exists"
          : "Email already exists",
    });
  }

  // Firebase errors
  if (err.code?.startsWith("auth/")) {

    console.log("🔥 Firebase Error:", err.code);

    if (
      err.code ===
      "auth/email-already-exists"
    ) {
      return res.status(409).json({
        success: false,
        code: "EMAIL_EXISTS",
        error: "Email already exists",
      });
    }

    if (
      err.code ===
      "auth/invalid-email"
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_EMAIL",
        error: "Invalid email",
      });
    }

    if (
      err.code ===
      "auth/weak-password"
    ) {
      return res.status(400).json({
        success: false,
        code: "WEAK_PASSWORD",
        error: "Weak password",
      });
    }
  }

  // Validation
  if (err.name === "ValidationError") {

    console.log("⚠️ Validation Error");

    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      error: Object.values(err.errors).map(
        (e: any) => e.message
      ),
    });
  }

  // Fallback
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error:
      env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
async function startServer() {

  try {

    console.log("🗄️ Connecting MongoDB...");

    await connectMongo();

    console.log("✅ MongoDB connected");

    console.log("🔥 Initializing Firebase Admin...");

    await initFirebaseAdmin();

    console.log("✅ Firebase Admin initialized");

    console.log("🔌 Initializing sockets...");

    initSocket(httpServer);

    console.log("✅ Socket server ready");

    httpServer.listen(
      env.PORT,
      "0.0.0.0",
      () => {

        console.log("\n========================================");
        console.log("🚀 BLOWSAFE BACKEND LIVE");
        console.log("🌍 Environment:", env.NODE_ENV);
        console.log("🌐 Port:", env.PORT);
        console.log("⏰ Live At:", new Date().toISOString());
        console.log("========================================\n");
      }
    );

  } catch (err) {

    console.log("\n========================================");
    console.log("❌ SERVER START FAILED");
    console.log(err);
    console.log("========================================\n");

    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// PROCESS ERRORS
// ─────────────────────────────────────────────
process.on("uncaughtException", (err) => {

  console.log("\n========================================");
  console.log("❌ UNCAUGHT EXCEPTION");
  console.log(err);
  console.log("========================================\n");

  process.exit(1);
});

process.on("unhandledRejection", (reason) => {

  console.log("\n========================================");
  console.log("❌ UNHANDLED REJECTION");
  console.log(reason);
  console.log("========================================\n");
});

// ─────────────────────────────────────────────
// START APP
// ─────────────────────────────────────────────
startServer();

export { app, httpServer };