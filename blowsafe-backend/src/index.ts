/**
 * blowsafe-backend/src/index.ts
 * BlowSafe API server entry point (ADVANCED LOGGING + LOGIN ROUTE)
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit, { ipKeyGenerator } from "express-rate-limit"; // ✅ Added ipKeyGenerator

import { env } from "./config/env";
import { connectMongo } from "./config/mongo";
import { initFirebaseAdmin } from "./config/firebase";
import { initSocket } from "./config/socket";
import { blockCommercialVPN } from "./middleware/vpnBlocker";

// Routes
import registerRoutes from "./routes/register";
import loginRoutes from "./routes/login"; // 🔐 LOGIN ROUTE
// import authRoutes from "./routes/auth"; // 👈 Uncomment ONLY if you have other /api/auth/* routes
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
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
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
// REQUEST LOGGER (ADVANCED)
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  const started = Date.now();
  const requestId = Math.random().toString(36).slice(2, 10);

  const ip =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.ip ||
    req.socket.remoteAddress ||
    "unknown";

  // Skip logging for health checks to reduce noise
  const isHealthCheck = req.path === "/health" || req.path === "/";
  
  if (!isHealthCheck) {
    console.log("\n========================================");
    console.log(`📥 [${requestId}] Incoming Request`);
    console.log("Method :", req.method);
    console.log("Path   :", req.originalUrl);
    console.log("IP     :", ip);
    console.log("Time   :", new Date().toISOString());

    // Log body (sanitize sensitive fields)
    if (req.body && Object.keys(req.body).length > 0) {
      const sanitized = { ...req.body };
      if (sanitized.password) sanitized.password = "********";
      if (sanitized.token) sanitized.token = "********";
      console.log("Body   :", sanitized);
    }
  }

  // Capture response details
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    if (!isHealthCheck) {
      const duration = Date.now() - started;
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`📤 [${requestId}] Response Sent`);
      console.log("Status :", res.statusCode);
      console.log("Time   :", `${duration}ms`);
      
      // Log response body for errors or login attempts
      if (res.statusCode >= 400 || req.path.includes("/login")) {
        console.log("Response:", data);
      }
      console.log("========================================\n");
    }
    return originalJson(data);
  };

  next();
});

// ─────────────────────────────────────────────
// VPN BLOCKER
// ─────────────────────────────────────────────
console.log("🔐 Loading VPN blocker...");
app.use(blockCommercialVPN);
console.log("✅ VPN blocker active");

// ─────────────────────────────────────────────
// RATE LIMITER (IPv6-SAFE ✅)
// ─────────────────────────────────────────────
console.log("🚦 Configuring rate limiter...");

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // ✅ IPv6-safe key generator
  keyGenerator: ipKeyGenerator({
    ipv6SubnetBits: 64,
    ipv4SubnetBits: 32,
  }),
  handler: (req, res) => {
    console.log("🚫 RATE LIMIT EXCEEDED | IP:", req.ip);
    return res.status(429).json({
      success: false,
      code: "RATE_LIMITED",
      error: "Too many requests",
    });
  },
});

// Stricter limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  // ✅ IPv6-safe key generator
  keyGenerator: ipKeyGenerator({
    ipv6SubnetBits: 64,
    ipv4SubnetBits: 32,
  }),
  handler: (req, res) => {
    console.log("🔐 LOGIN RATE LIMIT | IP:", req.ip);
    return res.status(429).json({
      success: false,
      code: "LOGIN_RATE_LIMITED",
      message: "Too many login attempts. Try again in 15 minutes.",
    });
  },
});

console.log("✅ Rate limiter ready");

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────
console.log("🛣️ Loading routes...");

// Register (public)
app.use("/api/auth/register", publicLimiter, registerRoutes);

// 🔐 LOGIN ROUTE (with stricter rate limiting + logging)
app.use("/api/auth/login", loginLimiter, loginRoutes);

// 👇 Other auth routes — UNCOMMENT ONLY if you have ./routes/auth.ts
// app.use("/api/auth", authRoutes);

// Protected routes
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
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────
app.use((req, res) => {
  console.log("❌ 404 | Path:", req.originalUrl, "| IP:", req.ip);
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
  if (res.headersSent) return next(err);

  console.log("\n========================================");
  console.log("❌ GLOBAL ERROR");
  console.log("Path   :", req.originalUrl);
  console.log("Method :", req.method);
  console.log("Code   :", err.code);
  console.log("Message:", err.message);
  if (err.stack) console.log("Stack:\n", err.stack);
  console.log("========================================\n");

  // Mongo duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];
    console.log("🚫 Mongo Duplicate:", field);
    return res.status(409).json({
      success: false,
      code: field === "officerId" ? "OFFICER_ID_EXISTS" : "EMAIL_EXISTS",
      error: field === "officerId" ? "Officer ID already exists" : "Email already exists",
    });
  }

  // Firebase auth errors
  if (err.code?.startsWith("auth/")) {
    console.log("🔥 Firebase Error:", err.code);
    const firebaseErrors: Record<string, { status: number; code: string; message: string }> = {
      "auth/email-already-exists": { status: 409, code: "EMAIL_EXISTS", message: "Email already exists" },
      "auth/invalid-email": { status: 400, code: "INVALID_EMAIL", message: "Invalid email" },
      "auth/weak-password": { status: 400, code: "WEAK_PASSWORD", message: "Weak password" },
      "auth/id-token-expired": { status: 401, code: "TOKEN_EXPIRED", message: "Token expired" },
      "auth/invalid-id-token": { status: 401, code: "INVALID_TOKEN", message: "Invalid token" },
    };
    const fbErr = firebaseErrors[err.code];
    if (fbErr) {
      return res.status(fbErr.status).json({
        success: false,
        code: fbErr.code,
        error: fbErr.message,
      });
    }
  }

  // Validation errors
  if (err.name === "ValidationError") {
    console.log("⚠️ Validation Error");
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      error: Object.values(err.errors).map((e: any) => e.message),
    });
  }

  // Fallback
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error: env.NODE_ENV === "production" ? "Internal server error" : err.message,
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

    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log("\n========================================");
      console.log("🚀 BLOWSAFE BACKEND LIVE");
      console.log("🌍 Environment:", env.NODE_ENV);
      console.log("🌐 Port:", env.PORT);
      console.log("🔗 URL: http://localhost:" + env.PORT);
      console.log("⏰ Live At:", new Date().toISOString());
      console.log("========================================\n");
    });
  } catch (err) {
    console.log("\n========================================");
    console.log("❌ SERVER START FAILED");
    console.log(err);
    console.log("========================================\n");
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// PROCESS ERROR HANDLERS
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