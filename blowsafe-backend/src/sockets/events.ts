/**
 * src/sockets/events.ts
 * Typed event emission helpers.
 * Import these in REST route handlers to push real-time updates.
 *
 * Usage:
 *   import { emitToUser, emitToRole, emitGlobal } from "../sockets/events";
 *
 *   // After POST /api/admin/officers/:id/role
 *   emitToUser("role_update", payload, targetOfficerId);
 *
 *   // After POST /api/alerts
 *   emitToRole("new_alert", payload, "admin");
 *
 *   // Broadcast to everyone
 *   emitGlobal("system_alert", payload);
 */

import crypto                     from "crypto";
import type { Server }            from "socket.io";
import { EVENTS, ROOMS }          from "../types/socket";
import type {
  AlertPayload,
  EmitResult,
  HeartbeatPayload,
  RecordUploadedPayload,
  RoleUpdatePayload,
} from "../types/socket";
import { getIO }                  from "./server";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEventId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function logEmit(room: string, event: string, success: boolean): void {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[WS emit] ${success ? "✅" : "❌"} ${event} → ${room}`);
  }
}

function tryEmit(
  room:    string,
  event:   string,
  payload: unknown
): EmitResult {
  const result: EmitResult = {
    room,
    event,
    timestamp: Date.now(),
    success:   false,
  };
  try {
    const io = getIO();
    io.to(room).emit(event, payload);
    result.success = true;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[WS emit] Failed ${event} → ${room}:`, result.error);
  }
  logEmit(room, event, result.success);
  return result;
}

// ─── Public emission API ──────────────────────────────────────────────────────

/** Emit to a single officer's personal room. */
export function emitToUser(
  event:     string,
  payload:   unknown,
  officerId: string
): EmitResult {
  return tryEmit(ROOMS.user(officerId), event, {
    ...(typeof payload === "object" && payload !== null ? payload : { data: payload }),
    eventId:   makeEventId(),
    timestamp: Date.now(),
  });
}

/** Emit to all sockets in a role room. */
export function emitToRole(
  event:   string,
  payload: unknown,
  role:    string
): EmitResult {
  return tryEmit(ROOMS.role(role), event, {
    ...(typeof payload === "object" && payload !== null ? payload : { data: payload }),
    eventId:   makeEventId(),
    timestamp: Date.now(),
  });
}

/** Emit to every connected socket (global room). */
export function emitGlobal(
  event:   string,
  payload: unknown
): EmitResult {
  return tryEmit(ROOMS.global, event, {
    ...(typeof payload === "object" && payload !== null ? payload : { data: payload }),
    eventId:   makeEventId(),
    timestamp: Date.now(),
  });
}

// ─── Domain-specific emitters (used by REST routes) ──────────────────────────

/**
 * Notify an officer that their role or status changed.
 * Called from: PATCH /api/admin/officers/:id/role
 *              PATCH /api/admin/officers/:id/status
 */
export function emitRoleUpdate(payload: Omit<RoleUpdatePayload, "timestamp">): void {
  const full: RoleUpdatePayload = { ...payload, timestamp: Date.now() };
  emitToUser(EVENTS.ROLE_UPDATE, full, payload.officerId);
  emitToRole(EVENTS.ROLE_UPDATE, full, "admin");
  emitToRole(EVENTS.ROLE_UPDATE, full, "superadmin");
}

/**
 * Notify admins a new BAC record was uploaded.
 * Called from: POST /api/upload
 */
export function emitRecordUploaded(
  payload: Omit<RecordUploadedPayload, "timestamp">
): void {
  const full: RecordUploadedPayload = { ...payload, timestamp: Date.now() };
  emitToRole(EVENTS.RECORD_UPLOADED, full, "admin");
  emitToRole(EVENTS.RECORD_UPLOADED, full, "superadmin");
}

/**
 * Push a critical alert to all admins.
 */
export function emitAlert(
  alert: Omit<AlertPayload, "eventId" | "timestamp">
): void {
  const full: AlertPayload = {
    ...alert,
    eventId:   makeEventId(),
    timestamp: Date.now(),
  };
  emitGlobal(EVENTS.NEW_ALERT, full);
}

// ─── Server-wide heartbeat ────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;

/** Start a server-side heartbeat so clients can detect stale connections. */
export function startHeartbeat(io: Server): NodeJS.Timeout {
  const startTime = Date.now();

  return setInterval(() => {
    const payload: HeartbeatPayload = {
      serverTime: Date.now(),
      uptime:     Math.floor((Date.now() - startTime) / 1000),
    };
    io.emit(EVENTS.HEARTBEAT, payload);
  }, HEARTBEAT_INTERVAL_MS);
}