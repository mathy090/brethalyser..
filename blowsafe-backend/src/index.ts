/**
 * src/index.ts
 * BlowSafe API server entry point
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
// Optional: Add rate limiting for open endpoints
// import rateLimit from "express-rate-limit";

import { env } from "./config/env";
import { connectMongo } from "./config/mongo";
import { initSocket } from "./config/socket";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";

const app = express();
const httpServer = createServer(app);

// ────────────────────────────────
// Global middleware
// ────────────────────────────────

app.use(helmet());
app.use(compression());

// CORS: Allow all origins for now (adjust for production)
// If you need to send cookies/credentials later, change to:
// cors({ origin: ["https://yourapp.com"], credentials: true })
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" })); // Increase limit for bulk imports

// ─── Optional: Rate limiting for open endpoints ─────────────────────────────
// Protect /import from abuse since it has no auth
// const importLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 20, // limit each IP to 20 import requests per windowMs
//   message: { error: "Too many import attempts, please try again later" },
//   standardHeaders: true,
//   legacyHeaders: false,
// });
// Apply only to the import route (add in admin.ts or here with path matching)
// app.use("/api/admin/officers/import", importLimiter);

// ─── Optional: Request logging for debugging ────────────────────────────────
// if (env.NODE_ENV === "development") {
//   app.use((req, _res, next) => {
//     console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
//     next();
//   });
// }

// ────────────────────────────────
// Routes
// ────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (_req, res) => {
  res.json({ status: "ok", app: "BlowSafe", version: "1.0.0" });
});

app.get("/health", (_req, res) => {
  res.json({ 
    status: "ok", 
    app: "BlowSafe",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ────────────────────────────────
// 404 handler
// ────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    message: "Endpoint not found",
    code: "NOT_FOUND",
  });
});

// ────────────────────────────────
// Global error handler (catches unhandled errors)
// ────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("❌ Unhandled error:", err);
  
  // Don't leak error details in production
  const isProduction = env.NODE_ENV === "production";
  
  res.status(500).json({
    message: isProduction ? "Internal server error" : err.message,
    code: "INTERNAL_ERROR",
    ...( !isProduction && { stack: err.stack }),
  });
});

// ────────────────────────────────
// Boot sequence
// ────────────────────────────────

async function startServer() {
  try {
    // 1. Connect MongoDB
    await connectMongo();
    console.log("✅ MongoDB connected");

    // 2. Init Socket.IO
    initSocket(httpServer);
    console.log("✅ Socket initialized");

    // 3. Start HTTP server (IMPORTANT: 0.0.0.0 for Render/Docker)
    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`[BlowSafe] 🚀 Server running on port ${env.PORT}`);
      console.log(`[BlowSafe] 📡 Environment: ${env.NODE_ENV}`);
    });

    // Handle graceful shutdown
    process.on("SIGTERM", () => {
      console.log("🔄 SIGTERM received, shutting down gracefully");
      httpServer.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });
    });

  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Catch unhandled promise rejections globally
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// Start app
startServer();