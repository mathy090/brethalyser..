/**
 * src/index.ts
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
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";

const app = express();
const httpServer = createServer(app);

// ────────────────────────────────
// Global middleware
// ────────────────────────────────

app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json());

// ────────────────────────────────
// Routes
// ────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (_req, res) => {
  res.json({ status: "ok", app: "BlowSafe" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "BlowSafe" });
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

    // 3. Start HTTP server (IMPORTANT: 0.0.0.0 for Render)
    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`[BlowSafe] 🚀 Server running on port ${env.PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Start app
startServer();