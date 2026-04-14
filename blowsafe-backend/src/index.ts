/**
 * src/index.ts
 *
 * BlowSafe API server entry point.
 *
 * Boot order:
 *   1. env validation  (process exits if any required var is missing)
 *   2. MongoDB connect (process exits on failure)
 *   3. Socket.IO init
 *   4. HTTP listen
 */

import express    from "express";
import { createServer } from "http";
import cors       from "cors";
import helmet     from "helmet";
import compression from "compression";

import { env }          from "./config/env";      // must be first — validates env
import { connectMongo } from "./config/mongo";
import { initSocket }   from "./config/socket";
import authRoutes       from "./routes/auth";
import adminRoutes      from "./routes/admin";

const app        = express();
const httpServer = createServer(app);

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/auth",  authRoutes);
app.use("/api/admin", adminRoutes);

app.get("/",       (_req, res) => res.json({ status: "ok", app: "BlowSafe" }));
app.get("/health", (_req, res) => res.json({ status: "ok", app: "BlowSafe" }));

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ message: "Endpoint not found.", code: "NOT_FOUND" });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

connectMongo().then(() => {
  initSocket(httpServer);
  httpServer.listen(env.PORT, () => {
    console.log(`[BlowSafe] 🚀  Server running on port ${env.PORT}`);
  });
});