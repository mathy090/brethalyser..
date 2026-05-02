import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import fs from "fs/promises";

import { env } from "./config/env";
import { connectMongo } from "./config/mongo";
import { initSocket } from "./config/socket";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";

const app = express();
const httpServer = createServer(app);

// ────────────────────────────────
// Middleware
// ────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

// ────────────────────────────────
// Routes
// ────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes); // ✔ keep this

// Health
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    app: "BlowSafe",
    version: "1.0.0",
    environment: env.NODE_ENV,
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Serve uploads (dev only)
if (env.NODE_ENV === "development") {
  const uploadsDir = path.join(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadsDir));
}

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    message: "Endpoint not found",
    path: _req.path,
    method: _req.method,
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Error:", err);

  res.status(500).json({
    message: env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ────────────────────────────────
// Start server
// ────────────────────────────────
async function startServer() {
  try {
    await connectMongo();
    console.log("✅ MongoDB connected");

    initSocket(httpServer);

    const uploadsDir = path.join(process.cwd(), "uploads", "driver-photos");
    await fs.mkdir(uploadsDir, { recursive: true });

    httpServer.listen(env.PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${env.PORT}`);
    });

  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

startServer();

export { app, httpServer };