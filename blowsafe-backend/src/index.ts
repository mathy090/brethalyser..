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
import { blockCommercialVPN } from "./middleware/vpnBlocker";

// Routes
import registerRoutes from "./routes/register";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";
import recordsRoutes from "./routes/records";

const app = express();
const httpServer = createServer(app);

// ─── Proxy Trust ─────────────────────────────
app.set("trust proxy", 1);

// ─── Security Middleware ─────────────────────
app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(compression());

app.use(
  cors({
    origin: env.NODE_ENV === "production" ? env.CORS_ORIGIN : "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── VPN Blocker ─────────────────────────────
app.use(blockCommercialVPN);

// ─── Rate Limiting ───────────────────────────
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // FIXED (was 5 → too strict)
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || "unknown",
});

// ─── Routes ──────────────────────────────────
app.use("/api/auth/register", publicLimiter, registerRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);
app.use("/api", recordsRoutes);

// ─── Health ──────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    app: "BlowSafe",
    version: "1.0.0",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
  });
});

// ─── 404 ─────────────────────────────────────
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: "NOT_FOUND",
    message: "Endpoint not found",
    path: req.path,
  });
});

// ─── GLOBAL ERROR HANDLER (FIXED) ───────────
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);

  console.error("❌ Error:", err);

  // ─── MONGO DUPLICATE KEY ───────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];

    return res.status(409).json({
      success: false,
      code: field === "officerId" ? "OFFICER_ID_EXISTS" : "DUPLICATE_ENTRY",
      field,
      message:
        field === "officerId"
          ? "Account already in use. Please use your correct officer ID."
          : "Duplicate entry detected.",
    });
  }

  // ─── FIREBASE ERRORS ────────────────────
  if (err.code?.startsWith("auth/")) {
    if (err.code === "auth/email-already-exists") {
      return res.status(409).json({
        success: false,
        code: "EMAIL_EXISTS",
        field: "email",
        message: "Email already registered.",
      });
    }

    if (err.code === "auth/invalid-email") {
      return res.status(400).json({
        success: false,
        code: "INVALID_EMAIL",
        field: "email",
        message: "Invalid email address.",
      });
    }

    if (err.code === "auth/weak-password") {
      return res.status(400).json({
        success: false,
        code: "WEAK_PASSWORD",
        field: "password",
        message: "Password is too weak.",
      });
    }
  }

  // ─── VALIDATION ERRORS ───────────────────
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      errors: Object.values(err.errors).map((e: any) => e.message),
    });
  }

  // ─── DEFAULT ─────────────────────────────
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message:
      env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// ─── SERVER START ───────────────────────────
async function startServer() {
  try {
    await connectMongo();
    await initFirebaseAdmin();
    initSocket(httpServer);

    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`🚀 BlowSafe running on port ${env.PORT}`);
    });
  } catch (err) {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  }
}

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

startServer();

export { app, httpServer };