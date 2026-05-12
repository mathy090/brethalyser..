/**
 * src/sockets/server.ts
 *
 * Socket.IO server initialization.
 * - Mounts on Express HTTP server
 * - JWT auth middleware
 * - Redis adapter (if available)
 * - Room management + event emitters
 * - Graceful close support
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as HTTPServer } from "http";
import type { RedisClientType } from "redis";

import { verifyToken } from "../auth/jwt";
import { env } from "../config/env";

// ── Types ───────────────────────────────────────────────────────────────────
export interface SocketUser {
  officerId: string;
  role: string;
  uid: string;
}

declare module "socket.io" {
  interface Socket {
    data: {
      user: SocketUser;
    };
  }
}

// ── State ───────────────────────────────────────────────────────────────────
let _io: SocketIOServer | null = null;
let _redisAttached = false;

// ── Create Socket.IO Server ─────────────────────────────────────────────────
export function createSocketServer(
  httpServer: HTTPServer,
  redisPub: RedisClientType | null,
  redisSub: RedisClientType | null
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    // Transport
    transports: ["websocket"],
    allowEIO3: false,

    // Heartbeat
    pingInterval: 25_000,
    pingTimeout: 20_000,

    // Payload limits
    maxHttpBufferSize: 1_048_576, // 1 MB

    // CORS
    cors: {
      origin:
        env.NODE_ENV === "production"
          ? (env.CORS_ORIGIN ?? "")
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : true,
      methods: ["GET", "POST"],
      credentials: true,
    },

    // Connection recovery (missed events while offline)
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: true,
    },
  });

  // ── Redis adapter for horizontal scaling ─────────────────────────────────
  if (redisPub?.isOpen && redisSub?.isOpen) {
    try {
      io.adapter(createAdapter(redisPub, redisSub));
      _redisAttached = true;
      console.log("[Socket.IO] ✅ Redis adapter attached — multi-instance ready");
    } catch (err) {
      console.error("[Socket.IO] ⚠️  Failed to attach Redis adapter:", err);
    }
  } else {
    console.warn("[Socket.IO] ⚠️  Running in-memory (single-node mode)");
  }

  // ── Auth middleware ──────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const payload = await verifyToken(token);
      socket.data.user = {
        officerId: payload.officerId,
        role: payload.role,
        uid: payload.uid,
      };
      next();
    } catch (err) {
      console.error("[Socket.IO] Auth failed:", err);
      next(new Error("Invalid or expired token"));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    const { officerId, role } = socket.data.user;
    console.log(`[WS] ✅ Connected | ${officerId} | role=${role} | id=${socket.id}`);

    // Auto-join default rooms
    void socket.join([`user:${officerId}`, `role:${role}`, "global:alerts"]);

    // ── Room subscription handler ─────────────────────────────────────────
    socket.on("subscribe", ({ channel }: { channel: string }) => {
      // Validate channel format to prevent injection/abuse
      if (/^[a-z0-9:_\-.]+$/i.test(channel)) {
        void socket.join(channel);
        console.log(`[WS] 📡 ${officerId} subscribed to ${channel}`);
      } else {
        console.warn(`[WS] ⚠️  Invalid channel format: ${channel}`);
      }
    });

    socket.on("unsubscribe", ({ channel }: { channel: string }) => {
      void socket.leave(channel);
      console.log(`[WS] 📤 ${officerId} unsubscribed from ${channel}`);
    });

    // ── Disconnect handler ────────────────────────────────────────────────
    socket.on("disconnect", (reason) => {
      console.log(`[WS] ❌ Disconnected | ${officerId} | reason=${reason}`);
    });

    // ── Error handler ─────────────────────────────────────────────────────
    socket.on("error", (err: Error) => {
      console.error(`[WS] 💥 Error | ${officerId} | ${err.message}`);
    });
  });

  // ── Server-wide heartbeat (optional monitoring) ─────────────────────────
  startHeartbeat(io);

  _io = io;
  console.log("[Socket.IO] ✅ Server ready");
  return io;
}

// ── Close Socket.IO Server ────────────────────────────────────────────────
export async function closeSocketServer(): Promise<void> {
  if (_io) {
    // Disconnect all clients gracefully
    for (const id of _io.sockets.sockets.keys()) {
      _io.sockets.sockets.get(id)?.disconnect(true);
    }
    // Close the server
    await new Promise<void>((resolve) => {
      _io?.close(() => {
        console.log("[Socket.IO] 🔌 Server closed");
        resolve();
      });
    });
    _io = null;
    _redisAttached = false;
  }
}

// ── Get singleton instance ────────────────────────────────────────────────
export function getIO(): SocketIOServer {
  if (!_io) {
    throw new Error(
      "[Socket.IO] Server not initialized — call createSocketServer first"
    );
  }
  return _io;
}

// ── Event emitter helpers (for use in REST routes) ────────────────────────

/** Emit to a specific user's room */
export function emitToUser(
  officerId: string,
  event: string,
  payload: any
): void {
  if (!_io) return;
  _io.to(`user:${officerId}`).emit(event, {
    ...payload,
    _meta: { emittedAt: Date.now(), target: `user:${officerId}` },
  });
}

/** Emit to all users with a specific role */
export function emitToRole(
  role: string,
  event: string,
  payload: any
): void {
  if (!_io) return;
  _io.to(`role:${role}`).emit(event, {
    ...payload,
    _meta: { emittedAt: Date.now(), target: `role:${role}` },
  });
}

/** Emit to all connected admins (superadmin + admin) */
export function emitToAdmins(event: string, payload: any): void {
  if (!_io) return;
  _io.to("role:admin").emit(event, {
    ...payload,
    _meta: { emittedAt: Date.now(), target: "role:admin" },
  });
}

/** Global broadcast to all connected clients */
export function emitGlobal(event: string, payload: any): void {
  if (!_io) return;
  _io.emit(event, {
    ...payload,
    _meta: { emittedAt: Date.now(), target: "global" },
  });
}

/** Emit to multiple rooms at once */
export function emitToRooms(
  rooms: string[],
  event: string,
  payload: any
): void {
  if (!_io) return;
  const packet = {
    ...payload,
    _meta: { emittedAt: Date.now(), targets: rooms },
  };
  for (const room of rooms) {
    _io.to(room).emit(event, packet);
  }
}

// ── Heartbeat (optional: emit server health to monitoring room) ───────────
function startHeartbeat(io: SocketIOServer): void {
  // Emit heartbeat every 60s to monitoring room (if subscribed)
  const interval = setInterval(() => {
    io.to("global:monitoring").emit("heartbeat", {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      redisAttached: _redisAttached,
    });
  }, 60_000);

  // Clean up on process exit
  process.on("beforeExit", () => clearInterval(interval));
}