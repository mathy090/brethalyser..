/**
 * blowsafe-backend/src/index.ts
 * BlowSafe API server entry point
 * 
 * Session Strategy:
 * • Officers: Standard JWT + rate limiting (HTTP)
 * • Admins/Superadmins: WebSocket-only session persistence (1s heartbeat, instant logout)
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { Server as SocketIOServer } from "socket.io";
import { verify, JwtPayload } from "jsonwebtoken";

import { env } from "./config/env";
import { connectMongo } from "./config/mongo";
import { initFirebaseAdmin } from "./config/firebase";
import { blockCommercialVPN } from "./middleware/vpnBlocker";

// Routes
import registerRoutes from "./routes/register";
import loginRoutes from "./auth/login";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";
import recordsRoutes from "./routes/records";

const app = express();
const httpServer = createServer(app);

// ─────────────────────────────────────────────
// BOOT LOG + DYNAMIC URL DETECTION (Render-ready)
// ─────────────────────────────────────────────
console.log("\n========================================");
console.log("🚀 BOOTING BLOWSAFE BACKEND");
console.log("🌍 Environment:", env.NODE_ENV);
console.log("🌐 Internal Port:", env.PORT);

const getPublicUrls = () => {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  const isRender = !!renderUrl;
  return {
    http: isRender ? `https://${renderUrl}` : `http://0.0.0.0:${env.PORT}`,
    ws: isRender ? `wss://${renderUrl}` : `ws://0.0.0.0:${env.PORT}`,
    display: isRender ? renderUrl : `0.0.0.0:${env.PORT}`,
  };
};
const urls = getPublicUrls();
console.log("🌐 Public URL:", urls.http);
console.log("🔌 Public WS:", urls.ws);
console.log("⏰ Started:", new Date().toISOString());
console.log("========================================\n");

// ─────────────────────────────────────────────
// SECURITY
// ─────────────────────────────────────────────
app.set("trust proxy", true); // ✅ Required for Render proxy headers
app.disable("x-powered-by");

console.log("🛡️ Loading security middleware...");
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
console.log("✅ Security middleware loaded");

// ─────────────────────────────────────────────
// CORS (Render-friendly dynamic origin)
// ─────────────────────────────────────────────
console.log("🌍 Configuring CORS...");
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Allow mobile/Postman
      if (env.NODE_ENV === "production") {
        const allowed = [env.CORS_ORIGIN, `https://${process.env.RENDER_EXTERNAL_URL}`].filter(Boolean);
        return allowed.includes(origin) ? callback(null, true) : callback(new Error("Not allowed by CORS"));
      }
      return callback(null, true); // Dev: allow all
    },
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
  const ip = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "unknown";
  const isHealthCheck = req.path === "/health" || req.path === "/";
  
  if (!isHealthCheck) {
    console.log("\n========================================");
    console.log(`📥 [${requestId}] Incoming Request`);
    console.log("Method :", req.method);
    console.log("Path   :", req.originalUrl);
    console.log("IP     :", ip);
    console.log("Time   :", new Date().toISOString());
    if (req.body && Object.keys(req.body).length > 0) {
      const sanitized = { ...req.body };
      if (sanitized.password) sanitized.password = "********";
      if (sanitized.token) sanitized.token = "********";
      console.log("Body   :", sanitized);
    }
  }

  const originalJson = res.json.bind(res);
  res.json = (data) => {
    if (!isHealthCheck) {
      const duration = Date.now() - started;
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`📤 [${requestId}] Response Sent`);
      console.log("Status :", res.statusCode);
      console.log("Time   :", `${duration}ms`);
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
// RATE LIMITER (BUN-COMPATIBLE + IPv6-SAFE)
// ─────────────────────────────────────────────
console.log("🚦 Configuring rate limiter...");

const safeKeyGenerator = (req: express.Request): string => {
  return (
    req.headers["cf-connecting-ip"]?.toString() ||
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.ip ||
    "unknown"
  );
};

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: safeKeyGenerator,
  handler: (req, res) => {
    console.log("🚫 RATE LIMIT EXCEEDED | IP:", req.ip);
    return res.status(429).json({ success: false, code: "RATE_LIMITED", error: "Too many requests" });
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: safeKeyGenerator,
  handler: (req, res) => {
    console.log("🔐 LOGIN RATE LIMIT | IP:", req.ip);
    return res.status(429).json({ success: false, code: "LOGIN_RATE_LIMITED", message: "Too many login attempts. Try again in 15 minutes." });
  },
});

console.log("✅ Rate limiter ready");

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────
console.log("🛣️ Loading routes...");
app.use("/api/auth/register", publicLimiter, registerRoutes);
app.use("/api/auth/login", loginLimiter, loginRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);
app.use("/api", recordsRoutes);
console.log("✅ Routes loaded");

// ─────────────────────────────────────────────
// ROOT & HEALTH
// ─────────────────────────────────────────────
app.get("/", (_req, res) => {
  console.log("🏠 Root endpoint hit");
  res.json({ status: "ok", app: "BlowSafe", version: "1.0.0" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────
app.use((req, res) => {
  console.log("❌ 404 | Path:", req.originalUrl, "| IP:", req.ip);
  res.status(404).json({ success: false, code: "NOT_FOUND", error: "Endpoint not found", path: req.path });
});

// ─────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  console.log("\n========================================");
  console.log("❌ GLOBAL ERROR");
  console.log("Path   :", req.originalUrl);
  console.log("Method :", req.method);
  console.log("Code   :", err.code);
  console.log("Message:", err.message);
  if (err.stack) console.log("Stack:\n", err.stack);
  console.log("========================================\n");

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];
    console.log("🚫 Mongo Duplicate:", field);
    return res.status(409).json({
      success: false,
      code: field === "officerId" ? "OFFICER_ID_EXISTS" : "EMAIL_EXISTS",
      error: field === "officerId" ? "Officer ID already exists" : "Email already exists",
    });
  }
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
    if (fbErr) return res.status(fbErr.status).json({ success: false, code: fbErr.code, error: fbErr.message });
  }
  if (err.name === "ValidationError") {
    console.log("⚠️ Validation Error");
    return res.status(400).json({ success: false, code: "VALIDATION_ERROR", error: Object.values(err.errors).map((e: any) => e.message) });
  }
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error: env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ─────────────────────────────────────────────
// WEBSOCKET SETUP (Admin/Superadmin ONLY)
// ─────────────────────────────────────────────
const STRICT_ROLES = new Set(["admin", "superadmin"]);

function initWebSocket(server: ReturnType<typeof createServer>) {
  const io = new SocketIOServer(server, {
    cors: { origin: env.CORS_ORIGIN || "*", credentials: true },
    transports: ["websocket"],
  });

  // 🔐 Auth middleware for WebSocket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) return next(new Error("Missing authentication token"));
    try {
      const decoded = verify(token, env.JWT_SECRET, {
        issuer: "blowsafe-backend",
        audience: "blowsafe-frontend",
      }) as JwtPayload & { role: string; officerId: string; uid: string };
      
      // ✅ ONLY allow admin/superadmin to connect via WebSocket
      if (!STRICT_ROLES.has(decoded.role)) {
        console.warn(`🚫 WS Rejected: Officer ${decoded.officerId} has role "${decoded.role}"`);
        return next(new Error("Insufficient privileges for WebSocket session"));
      }
      
      (socket as any).user = decoded;
      next();
    } catch (err) {
      return next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const user = (socket as any).user;
    const timestamp = new Date().toISOString();
    
    // ✅ CLEAR CONNECT LOG
    console.log(`\n🔌 [${timestamp}] WS CONNECTED`);
    console.log(`   Officer: ${user.officerId}`);
    console.log(`   Role   : ${user.role}`);
    console.log(`   IP     : ${socket.handshake.address}`);
    console.log(`   UA     : ${socket.handshake.headers["user-agent"]?.slice(0, 60) || "unknown"}`);
    console.log(`========================================\n`);

    // Send welcome
    socket.emit("connected", { message: "Secure session established", timestamp: Date.now() });

    // ✅ 1-SECOND HEARTBEAT (Server → Client)
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let disconnectLogged = false;

    const startHeartbeat = () => {
      heartbeatTimer = setInterval(() => {
        socket.emit("ping"); // Server pings every 1000ms
      }, 1000);
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    // ✅ GUARANTEED DISCONNECT LOG (prevents race conditions)
    const logDisconnect = (reason: string) => {
      if (disconnectLogged) return; // Prevent duplicate logs
      disconnectLogged = true;
      stopHeartbeat();
      
      const ts = new Date().toISOString();
      console.log(`\n🔌 [${ts}] WS DISCONNECTED`);
      console.log(`   Officer: ${user.officerId}`);
      console.log(`   Role   : ${user.role}`);
      console.log(`   Reason : ${reason}`);
      console.log(`========================================\n`);
    };

    // Client responds to ping → connection alive
    socket.on("pong", () => {
      // Heartbeat acknowledged
    });

    // ✅ Handle disconnect with guaranteed logging
    socket.on("disconnect", (reason) => {
      logDisconnect(reason);
    });

    // ✅ Handle errors with guaranteed logging
    socket.on("error", (err) => {
      logDisconnect(`error:${err.message}`);
    });

    // ✅ Handle transport close (extra safety)
    socket.on("close", () => {
      logDisconnect("transport_close");
    });

    // Start heartbeat after connection is fully established
    startHeartbeat();
  });

  console.log("✅ WebSocket server ready");
  return io;
}

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

    console.log("🔌 Initializing WebSockets...");
    initWebSocket(httpServer);

    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log("\n========================================");
      console.log("🚀 BLOWSAFE BACKEND LIVE");
      console.log("🌍 Environment:", env.NODE_ENV);
      console.log("🌐 Internal Port:", env.PORT);
      console.log("🌐 Public URL:", urls.http);
      console.log("🔌 Public WS:", urls.ws);
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

startServer();

export { app, httpServer };