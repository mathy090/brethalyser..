import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import authRoutes from "./routes/auth";

const app = express();
const PORT = process.env.PORT ?? 5000;

// ── Middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);

// ── Health checks (UptimeRobot hits these) ────────────────────────────
app.get("/", (_, res) => res.json({ status: "ok", app: "BlowSafe" }));
app.get("/health", (_, res) => res.json({ status: "ok", app: "BlowSafe" }));

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`BlowSafe backend running on port ${PORT}`);
});