/**
 * src/middleware/rateLimiter.ts
 *
 * Simple in-process sliding-window rate limiter.
 * Keyed by IP address. Limits are read from validated env config.
 *
 * For production scale, replace the in-process Map with a Redis store
 * (e.g. rate-limit-redis + express-rate-limit).
 */

import type { Request, Response, NextFunction } from "express";

import { env }    from "../config/env";
import { Errors } from "../utils/errors";

interface WindowEntry {
  count:   number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

export const rateLimiter = (
  req:  Request,
  res:  Response,
  next: NextFunction
): void => {
  const ip     = req.ip ?? "unknown";
  const limit  = env.API_RATE_LIMIT;
  const window = env.API_RATE_LIMIT_WINDOW;
  const now    = Date.now();

  const entry = windows.get(ip);

  if (!entry || now > entry.resetAt) {
    // First request in this window — or the previous window expired.
    windows.set(ip, { count: 1, resetAt: now + window });
    next();
    return;
  }

  if (entry.count >= limit) {
    Errors.rateLimited(res);
    return;
  }

  entry.count++;
  next();
};