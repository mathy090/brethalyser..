/**
 * src/sockets/rooms.ts
 * Room subscription handlers.
 * Clients can request additional rooms beyond the auto-joined ones.
 * All payloads validated with Zod.
 */

import { z }                       from "zod";
import type { AuthenticatedSocket } from "../types/socket";
import { EVENTS, ROOMS }            from "../types/socket";

// ─── Zod schemas for client-sent payloads ────────────────────────────────────

const SubscribeUserSchema = z.object({
  officerId: z.string().min(1).max(20),
});

const SubscribeRoleSchema = z.object({
  role: z.enum(["officer", "admin", "superadmin"]),
});

// ─── Role hierarchy — only join rooms at or below your own role ───────────────

const ROLE_RANK: Record<string, number> = {
  officer:    1,
  admin:      2,
  superadmin: 3,
};

function canSubscribeToRole(
  myRole:     string,
  targetRole: string
): boolean {
  return ROLE_RANK[myRole] >= ROLE_RANK[targetRole];
}

/**
 * Register all room subscription event handlers for a socket.
 * Called once per connection in server.ts.
 */
export function registerRoomHandlers(socket: AuthenticatedSocket): void {
  const { officerId, role } = socket.data.user;

  // ── subscribe:user ─────────────────────────────────────────────────────────
  // Admins can subscribe to any officer's personal room.
  socket.on(EVENTS.SUBSCRIBE_USER, (raw: unknown) => {
    const result = SubscribeUserSchema.safeParse(raw);
    if (!result.success) {
      socket.emit("error", { code: "INVALID_PAYLOAD", message: "Invalid officerId" });
      return;
    }

    const { officerId: targetId } = result.data;

    // Officers can only subscribe to their own room
    if (role === "officer" && targetId !== officerId) {
      socket.emit("error", { code: "FORBIDDEN", message: "Cannot subscribe to another officer's room" });
      return;
    }

    const room = ROOMS.user(targetId);
    void socket.join(room);
    socket.data.rooms.add(room);
    console.log(`[WS rooms] ${officerId} joined ${room}`);
  });

  // ── subscribe:role ─────────────────────────────────────────────────────────
  // Only admins/superadmins can subscribe to role rooms.
  socket.on(EVENTS.SUBSCRIBE_ROLE, (raw: unknown) => {
    const result = SubscribeRoleSchema.safeParse(raw);
    if (!result.success) {
      socket.emit("error", { code: "INVALID_PAYLOAD", message: "Invalid role" });
      return;
    }

    const { role: targetRole } = result.data;

    if (!canSubscribeToRole(role, targetRole)) {
      socket.emit("error", { code: "FORBIDDEN", message: "Insufficient privileges" });
      return;
    }

    const room = ROOMS.role(targetRole);
    void socket.join(room);
    socket.data.rooms.add(room);
    console.log(`[WS rooms] ${officerId} joined ${room}`);
  });

  // ── ping / pong (application-level keepalive) ──────────────────────────────
  socket.on(EVENTS.PING, () => {
    socket.emit(EVENTS.PONG, { serverTime: Date.now() });
  });

  // ── Auto-leave cleanup on disconnect ──────────────────────────────────────
  socket.on("disconnect", () => {
    // Socket.IO removes from rooms automatically; log for audit
    console.log(`[WS rooms] ${officerId} left all rooms`);
  });
}