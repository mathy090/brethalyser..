/**
 * blowsafe-backend/src/index.ts  (UPDATED)
 *
 * Changes from previous version:
 *  • Imports createSocketServer + initRedis from the new sockets/ layer
 *  • Redis initialised before Socket.IO
 *  • Graceful shutdown closes Redis + HTTP server
 *  • REST routes can now call emitRoleUpdate / emitRecordUploaded directly
 *
 * EVERYTHING ELSE (Express setup, routes, auth, VPN blocker) is unchanged.
 */

import express                  from "express";
import { createServer }         from "http";
import cors                     from "cors";
import helmet                   from "helmet";
import compression              from "compression";
import rateLimit                from "express-rate-limit";

import { env }                  from "./config/env";
import { connectMongo }         from "./config/mongo";
import { initFirebaseAdmin }    from "./config/firebase";
import { initRedis, closeRedis } from "./config/redis";
import { createSocketServer }   from "./sockets/server";
import { blockCommercialVPN }   from "./middleware/vpnBlocker";

// ── Routes (unchanged) ────────────────────────────────────────────────────────
import registerRoutes from "./routes/register";
import loginRoutes    from "./auth/login";
import adminRoutes    from "./routes/admin";
import uploadRoutes   from "./routes/upload";
import recordsRoutes  from "./routes/records";

// ─── App setup ─────────────────────────────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);

app.set("trust proxy", true);
app.disable("x-powered-by");

// Security
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (env.NODE_ENV === "production") {
      const allowed = (env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
      return allowed.includes(origin) ? cb(null, true) : cb(new Error("CORS blocked"));
    }
    return cb(null, true);
  },
  credentials: true,
  methods:     ["GET","POST","PUT","DELETE","PATCH"],
  allowedHeaders: ["Content-Type","Authorization"],
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(blockCommercialVPN);

// Rate limiters
const keyGen = (req: express.Request) =>
  (req.headers["x-forwarded-for"] as string ?? req.ip ?? "unknown").split(",")[0].trim();

const publicLimiter = rateLimit({ windowMs: 15*60_000, max: 20, trustProxy: true, keyGenerator: keyGen,
  handler: (_r, res) => res.status(429).json({ success: false, code: "RATE_LIMITED" }) });

const loginLimiter = rateLimit({ windowMs: 15*60_000, max: 5, trustProxy: true, keyGenerator: keyGen,
  handler: (_r, res) => res.status(429).json({ success: false, code: "LOGIN_RATE_LIMITED" }) });

// Routes
app.use("/api/auth/register", publicLimiter, registerRoutes);
app.use("/api/auth/login",    loginLimiter,  loginRoutes);
app.use("/api/admin",         adminRoutes);
app.use("/api",               uploadRoutes);
app.use("/api",               recordsRoutes);

app.get("/",       (_req, res) => res.json({ status: "ok", app: "BlowSafe" }));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND" }));

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  console.error("[Unhandled]", err.message);
  res.status(500).json({ code: "INTERNAL_ERROR", message: env.NODE_ENV === "production" ? "Server error" : err.message });
});

// ─── Startup ───────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await connectMongo();
  await initFirebaseAdmin();

  // Init Redis — falls back gracefully if unavailable
  const { pub, sub } = await initRedis();

  // Mount Socket.IO (with or without Redis)
  createSocketServer(httpServer, pub, sub);

  httpServer.listen(env.PORT, "0.0.0.0", () => {
    console.log(`[BlowSafe] 🚀 Listening on :${env.PORT} (${env.NODE_ENV})`);
  });
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[BlowSafe] ${signal} received — shutting down`);
  httpServer.close(async () => {
    await closeRedis();
    console.log("[BlowSafe] Goodbye");
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException",  (err) => { console.error("[FATAL]", err); process.exit(1); });
process.on("unhandledRejection", (r)   => { console.error("[UNHANDLED]", r); });

start().catch((err) => { console.error("[Startup failed]", err); process.exit(1); });

export { app, httpServer };