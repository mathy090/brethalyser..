/**
 * src/types/socket.ts
 * All WebSocket payload types and event definitions.
 * Shared across server files — do NOT import from routes here.
 */

import type { Socket } from "socket.io";

// ─── Authenticated socket user ────────────────────────────────────────────────

export interface SocketUser {
  uid: string;
  officerId: string;
  role: "officer" | "admin" | "superadmin";
  status: "approved" | "pending" | "rejected";
}

// ─── Augment Socket with typed data ──────────────────────────────────────────

export interface AuthenticatedSocket extends Socket {
  data: {
    user: SocketUser;
    connectedAt: number;
    rooms: Set<string>;
  };
}

// ─── Room names (type-safe constants) ────────────────────────────────────────

export const ROOMS = {
  user:   (officerId: string) => `user:${officerId}`,
  role:   (role: string)      => `role:${role}`,
  global: "global:alerts",
} as const;

// ─── Event names ──────────────────────────────────────────────────────────────

export const EVENTS = {
  // Server → Client
  CONNECTED:         "connected",
  ROLE_UPDATE:       "role_update",
  STATUS_UPDATE:     "status_update",
  NEW_ALERT:         "new_alert",
  SYSTEM_ALERT:      "system_alert",
  RECORD_UPLOADED:   "record_uploaded",
  OFFICER_APPROVED:  "officer_approved",
  OFFICER_REJECTED:  "officer_rejected",
  SESSION_EXPIRED:   "session_expired",
  HEARTBEAT:         "heartbeat",

  // Client → Server
  SUBSCRIBE_USER:    "subscribe:user",
  SUBSCRIBE_ROLE:    "subscribe:role",
  PING:              "ping",
  PONG:              "pong",
} as const;

// ─── Payload types ────────────────────────────────────────────────────────────

export interface ConnectedPayload {
  message:     string;
  officerId:   string;
  role:        string;
  timestamp:   number;
  sessionType: "websocket" | "http";
}

export interface RoleUpdatePayload {
  officerId:   string;
  role:        string;
  status:      string;
  updatedBy:   string;
  timestamp:   number;
}

export interface AlertPayload {
  eventId:   string;
  type:      "info" | "warning" | "critical";
  title:     string;
  message:   string;
  timestamp: number;
  meta?:     Record<string, unknown>;
}

export interface RecordUploadedPayload {
  driverId:   string;
  officerId:  string;
  bacValue:   number;
  overLimit:  boolean;
  fineAmount: number;
  timestamp:  number;
}

export interface HeartbeatPayload {
  serverTime: number;
  uptime:     number;
}

// ─── Emission result ──────────────────────────────────────────────────────────

export interface EmitResult {
  room:      string;
  event:     string;
  timestamp: number;
  success:   boolean;
  error?:    string;
}