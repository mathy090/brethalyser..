/**
 * blowsafe-backend/src/config/websocket.ts
 * 
 * WebSocket server for admin/superadmin session persistence.
 * 
 * Features:
 * • JWT authentication via socket.handshake.auth.token
 * • Role-based access (admin/superadmin only)
 * • 1-second heartbeat ping/pong
 * • Guaranteed disconnect logging
 * • Render-compatible CORS + proxy headers
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import { verify, JwtPayload } from "jsonwebtoken";
import { env } from "./env";

const STRICT_ROLES = new Set(["admin", "superadmin"]);

export function initWebSocket(httpServer: any) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (mobile apps, Postman)
        if (!origin) return callback(null, true);
        
        // Production: only allow configured origins
        if (env.NODE_ENV === "production") {
          const allowed = [env.CORS_ORIGIN, `https://${process.env.RENDER_EXTERNAL_URL}`].filter(Boolean);
          return allowed.includes(origin) ? callback(null, true) : callback(new Error("Not allowed by CORS"));
        }
        
        // Dev: allow all
        return callback(null, true);
      },
      credentials: true,
    },
    transports: ["websocket"], // Force WebSocket transport (no polling fallback)
    pingInterval: 1000,        // Server pings every 1 second
    pingTimeout: 2000,         // Disconnect if no pong within 2 seconds
  });

  // 🔐 Auth middleware: verify JWT + role BEFORE allowing connection
  io.use((socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth.token as string | undefined;
    
    if (!token) {
      console.warn(`🚫 WS Rejected: Missing token | IP: ${socket.handshake.address}`);
      return next(new Error("Missing authentication token"));
    }

    try {
      const decoded = verify(token, env.JWT_SECRET, {
        issuer: "blowsafe-backend",
        audience: "blowsafe-frontend",
      }) as JwtPayload & { role: string; officerId: string; uid: string };

      // 🔐 Role check: ONLY admin/superadmin can connect via WebSocket
      if (!STRICT_ROLES.has(decoded.role)) {
        console.warn(`🚫 WS Rejected: Insufficient privileges | Officer: ${decoded.officerId} | Role: ${decoded.role}`);
        return next(new Error("Insufficient privileges for WebSocket session"));
      }

      // Attach decoded user to socket for later use
      (socket as any).user = decoded;
      next();
    } catch (err: any) {
      console.warn(`🚫 WS Rejected: Invalid token | Error: ${err.message}`);
      return next(new Error("Invalid or expired token"));
    }
  });

  // ✅ Connection handler
  io.on("connection", (socket: Socket) => {
    const user = (socket as any).user;
    const timestamp = new Date().toISOString();
    
    // 🔵 CLEAR CONNECT LOG (this is what you're looking for)
    console.log(`\n🔌 [${timestamp}] WS CONNECTED`);
    console.log(`   Officer: ${user.officerId}`);
    console.log(`   Role   : ${user.role}`);
    console.log(`   IP     : ${socket.handshake.address}`);
    console.log(`   UA     : ${socket.handshake.headers["user-agent"]?.slice(0, 60) || "unknown"}`);
    console.log(`========================================\n`);

    // Send welcome + start heartbeat
    socket.emit("connected", { message: "Secure session established", timestamp: Date.now() });

    // ✅ Heartbeat: client responds to server ping with pong
    socket.on("pong", () => {
      // Connection alive - no action needed
    });

    // ✅ Guaranteed disconnect logging (prevents duplicate logs)
    let disconnectLogged = false;
    const logDisconnect = (reason: string) => {
      if (disconnectLogged) return;
      disconnectLogged = true;
      
      const ts = new Date().toISOString();
      console.log(`\n🔌 [${ts}] WS DISCONNECTED`);
      console.log(`   Officer: ${user.officerId}`);
      console.log(`   Role   : ${user.role}`);
      console.log(`   Reason : ${reason}`);
      console.log(`========================================\n`);
    };

    // Handle disconnect events
    socket.on("disconnect", (reason: string) => {
      logDisconnect(reason);
    });

    // Handle errors
    socket.on("error", (err: Error) => {
      logDisconnect(`error:${err.message}`);
    });

    // Handle transport close (extra safety for Render)
    socket.on("close", () => {
      logDisconnect("transport_close");
    });
  });

  // 🔍 Debug: Log connection errors that happen BEFORE authentication
  io.engine.on("connection_error", (err: any) => {
    console.error(`🔴 WS ENGINE ERROR: ${err.message}`);
    console.error(`   Code: ${err.code}`);
    console.error(`   Context: ${err.context}`);
  });

  console.log("✅ WebSocket server ready");
  return io;
}