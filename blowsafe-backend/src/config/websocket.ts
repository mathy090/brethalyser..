import { Server } from "socket.io";
import { verify, JwtPayload } from "jsonwebtoken";
import { env } from "./env";

const STRICT_ROLES = new Set(["admin", "superadmin"]);

export function initWebSocket(httpServer: any) {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN || "*", credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) return next(new Error("Missing authentication token"));

    try {
      const decoded = verify(token, env.JWT_SECRET) as JwtPayload & {
        role: string;
        officerId: string;
      };

      if (!STRICT_ROLES.has(decoded.role)) {
        return next(new Error("Insufficient privileges for WebSocket session"));
      }

      (socket as any).user = decoded;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const user = (socket as any).user;
    console.log(`🔌 WS Connected | Officer: ${user.officerId} | Role: ${user.role}`);

    socket.on("disconnect", (reason) => {
      console.log(`🔌 WS Disconnected | Officer: ${user.officerId} | Reason: ${reason}`);
    });
  });

  return io;
}