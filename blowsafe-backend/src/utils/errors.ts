/**
 * src/utils/errors.ts
 *
 * Centralised error catalogue for the BlowSafe API.
 *
 * Rules:
 *  - Every response that is not 2xx goes through one of these helpers.
 *  - Internal error details (stack traces, DB messages) are logged server-side
 *    and NEVER sent to the client.
 *  - Client receives a stable { message } string it can display directly.
 */

import type { Response } from "express";

// ─── HTTP error factory ──────────────────────────────────────────────────────

interface ApiErrorBody {
  message: string;
  code?:   string;
}

export function sendError(
  res:     Response,
  status:  number,
  message: string,
  code?:   string
): void {
  const body: ApiErrorBody = { message };
  if (code) body.code = code;
  res.status(status).json(body);
}

// ─── Named shorthand helpers ─────────────────────────────────────────────────

export const Errors = {
  // 400
  badRequest: (res: Response, message = "Bad request.") =>
    sendError(res, 400, message, "BAD_REQUEST"),

  missingFields: (res: Response, fields: string[]) =>
    sendError(
      res,
      400,
      `Missing required fields: ${fields.join(", ")}.`,
      "MISSING_FIELDS"
    ),

  invalidField: (res: Response, field: string, detail: string) =>
    sendError(res, 400, `Invalid ${field}: ${detail}`, "INVALID_FIELD"),

  // 401
  noToken: (res: Response) =>
    sendError(res, 401, "Authentication token is required.", "NO_TOKEN"),

  invalidToken: (res: Response) =>
    sendError(res, 401, "Token is invalid or has expired. Please sign in again.", "INVALID_TOKEN"),

  invalidRefreshToken: (res: Response) =>
    sendError(res, 401, "Refresh token is invalid or has expired. Please sign in again.", "INVALID_REFRESH_TOKEN"),

  // 403
  emailNotVerified: (res: Response) =>
    sendError(
      res,
      403,
      "Your email address has not been verified. Check your inbox for a verification link.",
      "EMAIL_NOT_VERIFIED"
    ),

  officerIdMismatch: (res: Response) =>
    sendError(
      res,
      403,
      "The Officer ID does not match this account.",
      "OFFICER_ID_MISMATCH"
    ),

  insufficientPermissions: (res: Response) =>
    sendError(res, 403, "You do not have permission to perform this action.", "FORBIDDEN"),

  // 404
  officerNotFound: (res: Response) =>
    sendError(res, 404, "Officer account not found.", "OFFICER_NOT_FOUND"),

  // 409
  emailTaken: (res: Response) =>
    sendError(
      res,
      409,
      "This email address is already registered. Sign in instead.",
      "EMAIL_TAKEN"
    ),

  officerIdTaken: (res: Response) =>
    sendError(
      res,
      409,
      "This Officer ID is already registered. Check your ID and try again.",
      "OFFICER_ID_TAKEN"
    ),

  accountAlreadyExists: (res: Response) =>
    sendError(
      res,
      409,
      "An account already exists for this Firebase user.",
      "ACCOUNT_EXISTS"
    ),

  // 429
  rateLimited: (res: Response) =>
    sendError(
      res,
      429,
      "Too many requests. Please wait a moment and try again.",
      "RATE_LIMITED"
    ),

  // 500
  internal: (res: Response, context: string, err: unknown) => {
    // Always log the real error server-side.
    console.error(`[BlowSafe] Internal error in ${context}:`, err);
    sendError(
      res,
      500,
      "An unexpected error occurred. Please try again.",
      "INTERNAL_ERROR"
    );
  },
};