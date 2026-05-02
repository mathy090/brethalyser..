
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
import uploadRoutes from "./routes/upload"; // 🔧 Import upload route

const app = express();
const httpServer = createServer(app);

// ────────────────────────────────
// Global middleware
// ────────────────────────────────

app.use(helmet()); // Security headers
app.use(compression()); // Gzip compression

// CORS: Allow all origins for mobile app (restrict in production)
app.use(cors({ origin: "*" }));

// JSON parsing with increased limit for bulk operations
app.use(express.json({ limit: "10mb" }));

// ────────────────────────────────
// Routes
// ────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes); // 🔧 Register upload route (unauthenticated)

// Health check endpoint
app.get("/", (_req, res) => {
  res.json({ 
    status: "ok", 
    app: "BlowSafe", 
    version: "1.0.0",
    environment: env.NODE_ENV 
  });
});

app.get("/health", (_req, res) => {
  res.json({ 
    status: "ok", 
    app: "BlowSafe",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    mongodb: "connected" // Could add actual DB ping here
  });
});

// ────────────────────────────────
// Serve uploaded files (Development only)
// ────────────────────────────────

if (env.NODE_ENV === "development") {
  const uploadsDir = path.join(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadsDir));
  console.log(`📁 Serving uploads from: ${uploadsDir}`);
}

// ────────────────────────────────
// 404 handler
// ────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    message: "Endpoint not found",
    code: "NOT_FOUND",
    path: _req.path,
    method: _req.method,
  });
});

// ────────────────────────────────
// Global error handler
// ────────────────────────────────

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Unhandled error:", err);
  
  const isProduction = env.NODE_ENV === "production";
  
  // Log error details in development
  if (!isProduction) {
    console.error("Request:", {
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query,
      params: req.params,
    });
  }
  
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
    // 1. Connect to MongoDB
    await connectMongo();
    console.log("✅ MongoDB connected");

    // 2. Initialize Socket.IO
    initSocket(httpServer);
    console.log("✅ Socket.IO initialized");

    // 3. Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads", "driver-photos");
    await fs.mkdir(uploadsDir, { recursive: true });
    console.log(`✅ Uploads directory ready: ${uploadsDir}`);

    // 4. Start HTTP server
    // Bind to 0.0.0.0 for Docker/Render compatibility
    const host = env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";
    
    httpServer.listen(env.PORT, host, () => {
      console.log(`🚀 BlowSafe API running on ${host}:${env.PORT}`);
      console.log(`📡 Environment: ${env.NODE_ENV}`);
      console.log(`🔗 API Base: ${env.API_BASE_URL}`);
    });

    // Handle graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`🔄 ${signal} received, shutting down gracefully...`);
      
      httpServer.close(() => {
        console.log("✅ HTTP server closed");
        process.exit(0);
      });
      
      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        console.error("❌ Could not close connections in time, forcefully shutting down");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Catch unhandled promise rejections globally
process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// Catch uncaught exceptions
process.on("uncaughtException", (error: Error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Start the application
startServer();

export { app, httpServer }; // For testing/exporting/**
 * src/index.ts
 * BlowSafe API server entry point
 * 
 * Features:
 * - Express server with security middleware
 * - MongoDB connection via Mongoose
 * - Socket.IO initialization
 * - File upload handling via multer
 * - Unauthenticated upload endpoint for driver + BAC data
 */

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
import uploadRoutes from "./routes/upload"; // 🔧 Import upload route

const app = express();
const httpServer = createServer(app);

// ────────────────────────────────
// Global middleware
// ────────────────────────────────

app.use(helmet()); // Security headers
app.use(compression()); // Gzip compression

// CORS: Allow all origins for mobile app (restrict in production)
app.use(cors({ origin: "*" }));

// JSON parsing with increased limit for bulk operations
app.use(express.json({ limit: "10mb" }));

// ────────────────────────────────
// Routes
// ────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes); // 🔧 Register upload route (unauthenticated)

// Health check endpoint
app.get("/", (_req, res) => {
  res.json({ 
    status: "ok", 
    app: "BlowSafe", 
    version: "1.0.0",
    environment: env.NODE_ENV 
  });
});

app.get("/health", (_req, res) => {
  res.json({ 
    status: "ok", 
    app: "BlowSafe",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    mongodb: "connected" // Could add actual DB ping here
  });
});

// ────────────────────────────────
// Serve uploaded files (Development only)
// ────────────────────────────────

if (env.NODE_ENV === "development") {
  const uploadsDir = path.join(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadsDir));
  console.log(`📁 Serving uploads from: ${uploadsDir}`);
}

// ────────────────────────────────
// 404 handler
// ────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    message: "Endpoint not found",
    code: "NOT_FOUND",
    path: _req.path,
    method: _req.method,
  });
});

// ────────────────────────────────
// Global error handler
// ────────────────────────────────

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Unhandled error:", err);
  
  const isProduction = env.NODE_ENV === "production";
  
  // Log error details in development
  if (!isProduction) {
    console.error("Request:", {
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query,
      params: req.params,
    });
  }
  
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
    // 1. Connect to MongoDB
    await connectMongo();
    console.log("✅ MongoDB connected");

    // 2. Initialize Socket.IO
    initSocket(httpServer);
    console.log("✅ Socket.IO initialized");

    // 3. Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads", "driver-photos");
    await fs.mkdir(uploadsDir, { recursive: true });
    console.log(`✅ Uploads directory ready: ${uploadsDir}`);

    // 4. Start HTTP server
    // Bind to 0.0.0.0 for Docker/Render compatibility
    const host = env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";
    
    httpServer.listen(env.PORT, host, () => {
      console.log(`🚀 BlowSafe API running on ${host}:${env.PORT}`);
      console.log(`📡 Environment: ${env.NODE_ENV}`);
      console.log(`🔗 API Base: ${env.API_BASE_URL}`);
    });

    // Handle graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`🔄 ${signal} received, shutting down gracefully...`);
      
      httpServer.close(() => {
        console.log("✅ HTTP server closed");
        process.exit(0);
      });
      
      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        console.error("❌ Could not close connections in time, forcefully shutting down");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Catch unhandled promise rejections globally
process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// Catch uncaught exceptions
process.on("uncaughtException", (error: Error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Start the application
startServer();

export { app, httpServer }; // For testing/exporting