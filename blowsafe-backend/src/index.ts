/**
 * blowsafe-backend/src/index.ts
 * BlowSafe API server entry point (FULL LOGGING VERSION)
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
// SECURITY CORE
// ─────────────────────────────────────────────
app.set("trust proxy", 1);
app.disable("x-powered-by");

console.log("🛡️ Initializing security middleware...");

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
    origin: env.NODE_ENV === "production"
      ? env.CORS_ORIGIN
      : "*",

    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

console.log("✅ CORS configured");

// ─────────────────────────────────────────────
// BODY PARSER
// ─────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

console.log("✅ Body parser initialized");

// ─────────────────────────────────────────────
// REQUEST LOGGER
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  const started = Date.now();

  const ip =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.ip ||
    req.socket.remoteAddress;

  console.log("\n========================================");
  console.log("📥 Incoming Request");
  console.log("Method :", req.method);
  console.log("Path   :", req.originalUrl);
  console.log("IP     :", ip);
  console.log("Time   :", new Date().toISOString());

  if (Object.keys(req.body || {}).length > 0) {
    console.log("Body   :", req.body);
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
// RATE LIMIT
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
    console.log("🚫 RATE LIMIT HIT");
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

app.use("/api/auth/register", publicLimiter, registerRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);
app.use("/api", recordsRoutes);

console.log("✅ Routes loaded");

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get("/", (_req, res) => {
  console.log("🏠 Root endpoint hit");

  res.json({
    status: "ok",
    app: "BlowSafe",
    version: "1.0.0",
  });
});

app.get("/health", (_req, res) => {
  console.log("💓 Health check requested");

  res.json({
    status: "ok",
    uptime: process.uptime(),
  });
});

// ─────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────
app.use((req, res) => {
  console.log("❌ 404 Not Found:", req.originalUrl);

  res.status(404).json({
    success: false,
    code: "NOT_FOUND",
    message: "Endpoint not found",
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
  console.log("❌ GLOBAL ERROR HANDLER");
  console.log("Path    :", req.originalUrl);
  console.log("Method  :", req.method);
  console.log("Message :", err.message);
  console.log("Code    :", err.code);
  console.log("Stack   :", err.stack);
  console.log("========================================\n");

  // ─────────────────────────────────────────
  // MONGO DUPLICATE
  // ─────────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];

    console.log("🚫 Mongo duplicate:", field);

    return res.status(409).json({
      success: false,
      code:
        field === "officerId"
          ? "OFFICER_ID_EXISTS"
          : "EMAIL_EXISTS",

      field,
      error:
        field === "officerId"
          ? "Officer ID already in use"
          : "Email already registered",
    });
  }

  // ─────────────────────────────────────────
  // FIREBASE ERRORS
  // ─────────────────────────────────────────
  if (err.code?.startsWith("auth/")) {

    console.log("🔥 Firebase error:", err.code);

    const firebaseErrors: Record<string, any> = {
      "auth/email-already-exists": {
        status: 409,
        code: "EMAIL_EXISTS",
        field: "email",
      },

      "auth/invalid-email": {
        status: 400,
        code: "INVALID_EMAIL",
        field: "email",
      },

      "auth/weak-password": {
        status: 400,
        code: "WEAK_PASSWORD",
        field: "password",
      },
    };

    const mapped = firebaseErrors[err.code];

    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        code: mapped.code,
        field: mapped.field,
        error: err.message,
      });
    }
  }

  // ─────────────────────────────────────────
  // VALIDATION
  // ─────────────────────────────────────────
  if (err.name === "ValidationError") {

    console.log("⚠️ Validation error");

    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: Object.values(err.errors).map(
        (e: any) => e.message
      ),
    });
  }

  // ─────────────────────────────────────────
  // FALLBACK
  // ─────────────────────────────────────────
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

    console.log("\n🚀 Starting BlowSafe Backend...");
    console.log("Environment:", env.NODE_ENV);
    console.log("Port:", env.PORT);

    // Mongo
    console.log("\n🗄️ Connecting MongoDB...");
    await connectMongo();
    console.log("✅ MongoDB connected");

    // Firebase
    console.log("\n🔥 Initializing Firebase Admin...");
    await initFirebaseAdmin();
    console.log("✅ Firebase Admin ready");

    // Socket
    console.log("\n🔌 Initializing sockets...");
    initSocket(httpServer);
    console.log("✅ Socket server ready");

    // Start HTTP server
    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log("\n========================================");
      console.log("🚀 BlowSafe Backend LIVE");
      console.log("🌍 Port :", env.PORT);
      console.log("🌎 Env  :", env.NODE_ENV);
      console.log("========================================\n");
    });

  } catch (err) {

    console.log("\n========================================");
    console.log("❌ STARTUP FAILED");
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
// START
// ─────────────────────────────────────────────
startServer();

export { app, httpServer };