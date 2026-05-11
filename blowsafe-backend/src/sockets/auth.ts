/**
 * src/sockets/auth.ts
 * JWT handshake authentication for Socket.IO connections.
 * Rejects expired, malformed, or low-privilege tokens before
 * the connection is established.
 */

import { verify, type JwtPayload } from "jsonwebtoken";
import type { Socket }             from "socket.io";

import type { SocketUser }         from "../types/socket";

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error("[Socket auth] JWT_SECRET env var is required");

interface DecodedToken extends JwtPayload {
  uid:       string;
  officerId: string;
  role:      SocketUser["role"];
  status:    SocketUser["status"];
}

/**
 * Socket.IO middleware — runs before every connection is accepted.
 * Extracts and verifies the JWT from `socket.handshake.auth.token`.
 */
export function authenticateSocket(
  socket: Socket,
  next:   (err?: Error) => void
): void {
  const token = socket.handshake.auth?.token as string | undefined;

  if (!token || typeof token !== "string" || token.trim() === "") {
    console.warn(`[WS auth] Rejected — no token | ip=${socket.handshake.address}`);
    return next(new Error("AUTH_MISSING_TOKEN"));
  }

  let decoded: DecodedToken;

  try {
    decoded = verify(token.trim(), JWT_SECRET, {
      issuer:   "blowsafe-backend",
      audience: "blowsafe-frontend",
    }) as DecodedToken;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "invalid";
    console.warn(`[WS auth] Rejected — token invalid | ${msg} | ip=${socket.handshake.address}`);
    return next(new Error("AUTH_INVALID_TOKEN"));
  }

  // Reject accounts that are not approved
  if (decoded.status !== "approved") {
    console.warn(`[WS auth] Rejected — status=${decoded.status} | officer=${decoded.officerId}`);
    return next(new Error("AUTH_ACCOUNT_NOT_APPROVED"));
  }

  // Attach user to socket.data for use in handlers
  (socket as any).data = {
    user: {
      uid:       decoded.uid,
      officerId: decoded.officerId,
      role:      decoded.role,
      status:    decoded.status,
    } satisfies SocketUser,
    connectedAt: Date.now(),
    rooms:       new Set<string>(),
  };

  next();
}
