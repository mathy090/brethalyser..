/**
 * blowsafe-backend/src/utils/auditLogger.ts
 * 
 * Centralized audit logging for security-critical events.
 * 
 * Features:
 *  - Writes to MongoDB 'audit_logs' collection
 *  - Auto-sanitizes sensitive fields (emails, tokens, passwords)
 *  - Non-blocking: errors never crash the main request
 *  - Structured schema for easy querying + compliance
 *  - Optional: stream to external SIEM (Splunk, Datadog) via webhook
 */

import { getDb } from "../config/mongo";
import { env } from "../config/env";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditEvent =
  | "login_attempt"
  | "login_success"
  | "login_error"
  | "logout"
  | "password_reset_request"
  | "password_reset_complete"
  | "account_created"
  | "account_updated"
  | "account_deleted"
  | "permission_changed"
  | "api_key_created"
  | "api_key_revoked"
  | "suspicious_activity"
  | "admin_action"
  | "system_event"
  | string; // Allow custom events

export interface AuditLogEntry {
  // Required fields
  event: AuditEvent;
  requestId: string;
  ip: string;
  timestamp: Date;

  // Optional context (flexible)
  officerId?: string;
  firebaseUid?: string;
  email?: string; // Will be sanitized before storage
  role?: string;
  success?: boolean;
  reason?: string;
  duration?: number; // ms

  // Error details (if applicable)
  error?: string;
  errorCode?: string;

  // Metadata (flexible key-value)
  metadata?: Record<string, any>;

  // System info
  userAgent?: string;
  endpoint?: string;
  method?: string;
}

// ─── Fields to sanitize before storing ───────────────────────────────────────

const SENSITIVE_FIELDS = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "jwt",
  "secret",
  "apiKey",
  "authorization",
  "attemptedEmail",
  "registeredEmail",
  "email",
] as const;

type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

// ─── Sanitization Helpers ────────────────────────────────────────────────────

/**
 * Recursively sanitize sensitive fields in an object.
 * Replaces values with "[REDACTED]" while preserving structure.
 */
function sanitizeSensitiveData<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;

  const sanitized = { ...obj } as T;

  for (const key of Object.keys(sanitized)) {
    const value = sanitized[key as keyof T];

    // Redact sensitive string fields
    if (SENSITIVE_FIELDS.includes(key as SensitiveField) && typeof value === "string") {
      sanitized[key as keyof T] = "[REDACTED]" as any;
      continue;
    }

    // Recursively sanitize nested objects (but not arrays of primitives)
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      sanitized[key as keyof T] = sanitizeSensitiveData(value as any);
    }

    // Sanitize arrays of objects
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      sanitized[key as keyof T] = value.map((item) =>
        item && typeof item === "object" ? sanitizeSensitiveData(item as any) : item
      ) as any;
    }
  }

  return sanitized;
}

/**
 * Hash IP address for privacy (optional, based on env flag).
 * Uses simple SHA-256 truncation — replace with proper anonymization for GDPR.
 */
async function anonymizeIp(ip: string): Promise<string> {
  if (!env.AUDIT_ANONYMIZE_IPS) return ip;

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(ip);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Return first 16 chars of hex hash (64 bits) — enough for grouping, not identifying
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    // Fallback: truncate IP manually (IPv4: x.x.x.0, IPv6: first /64)
    if (ip.includes(":")) {
      // IPv6: keep first 4 hextets
      return ip.split(":").slice(0, 4).join(":") + "::/64";
    }
    // IPv4: zero out last octet
    const parts = ip.split(".");
    if (parts.length === 4) {
      parts[3] = "0";
      return parts.join(".");
    }
    return ip;
  }
}

// ─── Main Audit Logger ───────────────────────────────────────────────────────

/**
 * Log a security audit event to MongoDB.
 * 
 * This function is non-blocking: if the DB write fails, it logs locally
 * but never throws or rejects, ensuring the main request flow continues.
 * 
 * @param data - Audit log entry (sans timestamp, which is auto-added)
 */
export async function logAudit(
  data: Omit<AuditLogEntry, "timestamp">
): Promise<void> {
  const startTime = Date.now();

  try {
    // 1. Prepare base entry
    const entry: AuditLogEntry = {
      ...data,
      timestamp: new Date(),
      // Auto-capture request context if not provided
      userAgent: data.userAgent,
      endpoint: data.endpoint,
      method: data.method,
    };

    // 2. Anonymize IP if configured
    if (entry.ip) {
      entry.ip = await anonymizeIp(entry.ip);
    }

    // 3. Sanitize sensitive fields
    const sanitized = sanitizeSensitiveData(entry);

    // 4. Write to MongoDB (non-blocking fire-and-forget)
    const db = await getDb();
    const collection = db.collection("audit_logs");

    // Fire-and-forget with error capture
    collection
      .insertOne(sanitized)
      .then((result) => {
        if (env.NODE_ENV === "development") {
          console.log("🪵 Audit log written:", {
            eventId: result.insertedId,
            event: sanitized.event,
            duration: Date.now() - startTime,
          });
        }
      })
      .catch((dbErr) => {
        // Never let DB errors crash the app
        console.error("❌ Audit log write failed:", {
          event: sanitized.event,
          requestId: sanitized.requestId,
          error: dbErr.message,
        });
      });

    // 5. (Optional) Stream to external SIEM/webhook
    if (env.AUDIT_WEBHOOK_URL) {
      // Fire-and-forget external log
      fetch(env.AUDIT_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.AUDIT_WEBHOOK_TOKEN && {
            Authorization: `Bearer ${env.AUDIT_WEBHOOK_TOKEN}`,
          }),
        },
        body: JSON.stringify({
          ...sanitized,
          source: "blowsafe-backend",
          environment: env.NODE_ENV,
        }),
      }).catch((err) => {
        console.error("⚠️ Audit webhook failed:", err.message);
      });
    }
  } catch (error: any) {
    // Final fallback: log to console if everything else fails
    console.error("❌ Audit logger internal error:", {
      event: data.event,
      requestId: data.requestId,
      error: error.message,
    });
  }
}

// ─── Convenience Helpers ─────────────────────────────────────────────────────

/**
 * Log a successful login (wrapper for common fields).
 */
export async function logLoginSuccess(params: {
  requestId: string;
  ip: string;
  officerId: string;
  firebaseUid: string;
  role: string;
  duration: number;
  userAgent?: string;
}): Promise<void> {
  return logAudit({
    event: "login_success",
    requestId: params.requestId,
    ip: params.ip,
    officerId: params.officerId,
    firebaseUid: params.firebaseUid,
    role: params.role,
    success: true,
    duration: params.duration,
    userAgent: params.userAgent,
    endpoint: "/api/auth/login",
    method: "POST",
  });
}

/**
 * Log a failed login attempt (wrapper for common fields).
 */
export async function logLoginFailure(params: {
  requestId: string;
  ip: string;
  officerId?: string;
  firebaseUid?: string;
  reason: string;
  errorCode: string;
  duration: number;
  userAgent?: string;
  attemptedEmail?: string;
}): Promise<void> {
  return logAudit({
    event: "login_attempt",
    requestId: params.requestId,
    ip: params.ip,
    officerId: params.officerId,
    firebaseUid: params.firebaseUid,
    success: false,
    reason: params.reason,
    errorCode: params.errorCode,
    duration: params.duration,
    userAgent: params.userAgent,
    attemptedEmail: params.attemptedEmail,
    endpoint: "/api/auth/login",
    method: "POST",
  });
}

/**
 * Log an admin action (e.g., approving an account).
 */
export async function logAdminAction(params: {
  requestId: string;
  ip: string;
  adminOfficerId: string;
  action: string;
  targetOfficerId?: string;
  details?: Record<string, any>;
  duration?: number;
}): Promise<void> {
  return logAudit({
    event: "admin_action",
    requestId: params.requestId,
    ip: params.ip,
    officerId: params.adminOfficerId,
    success: true,
    reason: params.action,
    metadata: params.details,
    duration: params.duration,
    endpoint: "/api/admin/*",
    method: "POST",
  });
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  logAudit,
  logLoginSuccess,
  logLoginFailure,
  logAdminAction,
  sanitizeSensitiveData,
};