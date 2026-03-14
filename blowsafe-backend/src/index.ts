import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import authRoutes from "./routes/auth";

// Bun reads .env automatically — no need for dotenv.config()
const app = express();
const PORT = process.env.PORT ?? 5000;

// ── Middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);

// ── Health check ──────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok" }));

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`BlowSafe backend running on port ${PORT}`);
});