import type { Request, Response, NextFunction } from "express";

const requests = new Map<string, { count: number; resetAt: number }>();

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip ?? "unknown";
  const limit = Number(process.env.API_RATE_LIMIT ?? 10);
  const window = Number(process.env.API_RATE_LIMIT_WINDOW ?? 60_000);
  const now = Date.now();
  const entry = requests.get(ip);

  if (!entry || now > entry.resetAt) {
    requests.set(ip, { count: 1, resetAt: now + window });
    next();
    return;
  }
  if (entry.count >= limit) {
    res.status(429).json({ message: "Too many requests. Try again later." });
    return;
  }
  entry.count++;
  next();
};
