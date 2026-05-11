/**
 * src/sockets/server.ts
 * Socket.IO server initialization.
 * Mounts on the existing Express HTTP server.
 * Wires Redis adapter (if available), auth middleware, and room handlers.
 */

import { Server as SocketIOServer }   from "socket.io";
import { createAdapter }               from "@socket.io/redis-adapter";
import type { Server as HTTPServer }   from "http";
import type Redis                      from "ioredis";

import { authenticateSocket }          from "./auth";
import { registerRoomHandlers }        from "./rooms";
import { startHeartbeat }              from "./events";

const CORS_ORIGIN = process.env.SOCKET_CORS_ORIGIN ?? process.env.CORS_ORIGIN ?? "*";
const NODE_ENV    = process.env.NODE_ENV ?? "development";

let _io: SocketIOServer | null = null;

/**
 * Create and configure the Socket.IO server.
 * Call once at startup — returns the `io` instance.
 */
export function createSocketServer(
  httpServer: HTTPServer,
  redisPub:   Redis | null,
  redisSub:   Redis | null
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    // ── Transport ─────────────────────────────────────────────────────────────
    transports:    ["websocket"],   // WS only — no long-polling fallback
    allowEIO3:     false,           // Block legacy Engine.IO v3 clients

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    pingInterval:  25_000,
    pingTimeout:   20_000,

    // ── Payload limits ────────────────────────────────────────────────────────
    maxHttpBufferSize: 1_048_576,   // 1 MB

    // ── CORS ──────────────────────────────────────────────────────────────────
    cors: {
      origin: NODE_ENV === "production"
        ? CORS_ORIGIN.split(",").map((o) => o.trim())
        : true,                     // Dev: allow all
      methods:     ["GET", "POST"],
      credentials: true,
    },

    // ── Connection state recovery (missed events while offline) ───────────────
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 min
      skipMiddlewares:          true,
    },
  });

  // ── Redis adapter for horizontal scaling ──────────────────────────────────
  if (redisPub && redisSub) {
    io.adapter(createAdapter(redisPub, redisSub));
    console.log("[Socket.IO] ✅ Redis adapter attached — multi-instance ready");
  } else {
    console.warn("[Socket.IO] ⚠️  No Redis — single-instance mode");
  }

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use(authenticateSocket);

  // ── Per-connection handlers ────────────────────────────────────────────────
  io.on("connection", (socket) => {
    const { officerId, role } = (socket as any).data.user;
    console.log(`[WS] Connected | ${officerId} | role=${role} | id=${socket.id}`);

    // Auto-join personal + role rooms
    void socket.join([`user:${officerId}`, `role:${role}`, "global:alerts"]);

    // Register room subscription handlers (client can request more)
    registerRoomHandlers(socket as any);

    socket.on("disconnect", (reason) => {
      console.log(`[WS] Disconnected | ${officerId} | reason=${reason}`);
    });

    socket.on("error", (err: Error) => {
      console.error(`[WS] Error | ${officerId} | ${err.message}`);
    });
  });

  // ── Server-wide heartbeat ──────────────────────────────────────────────────
  startHeartbeat(io);

  _io = io;
  console.log("[Socket.IO] ✅ Server ready");
  return io;
}

/** Get the singleton io instance (after createSocketServer has been called). */
export function getIO(): SocketIOServer {
  if (!_io) throw new Error("[Socket.IO] Server not initialised — call createSocketServer first");
  return _io;
}