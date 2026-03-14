import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import { connectMongo } from "./config/mongo";
import { initSocket } from "./config/socket";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT ?? 10000;

app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (_, res) => res.json({ status: "ok", app: "BlowSafe" }));
app.get("/health", (_, res) => res.json({ status: "ok", app: "BlowSafe" }));

connectMongo().then(() => {
  initSocket(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`BlowSafe backend running on port ${PORT}`);
  });
});