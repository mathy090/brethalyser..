/**
 * blowsafe-backend/src/middleware/vpnBlocker.ts
 * SAFE production VPN + datacenter detection middleware
 */

import { Request, Response, NextFunction } from "express";
import axios from "axios";
import CIDRMatcher from "cidr-matcher";
import { env } from "../config/env";

// ─────────────────────────────────────────────
// VPN LIST SOURCES
// ─────────────────────────────────────────────
const VPN_LIST_URLS = [
  "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt",
];

// ─────────────────────────────────────────────
// SAFE INFRASTRUCTURE (NEVER BLOCK)
// ─────────────────────────────────────────────
const SAFE_PREFIXES = [
  "127.",       // localhost
  "10.",        // private
  "192.168.",   // private
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "34.",        // Render / Google Cloud routing (avoid false blocks)
  "35.",
  "52.",
  "54.",
];

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let matcher: CIDRMatcher | null = null;
let lastLoad = 0;
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────
// FETCH VPN LIST
// ─────────────────────────────────────────────
const fetchVPNRanges = async (): Promise<string[]> => {
  for (const url of VPN_LIST_URLS) {
    try {
      const res = await axios.get(url, {
        timeout: 8000,
        headers: {
          "User-Agent": "BlowSafe-Security-Module",
        },
      });

      const lines = res.data.split("\n");

      const cidrs = lines
        .map((l: string) => l.trim())
        .filter((l: string) => l && l.includes("/") && !l.startsWith("#"));

      if (cidrs.length > 0) {
        console.log(`✅ VPN list loaded: ${cidrs.length} entries`);
        return cidrs;
      }
    } catch (err) {
      console.warn(`⚠️ VPN list fetch failed: ${url}`);
    }
  }

  console.warn("⚠️ Using empty VPN list fallback");
  return [];
};

// ─────────────────────────────────────────────
// LOAD MATCHER
// ─────────────────────────────────────────────
const loadMatcher = async () => {
  try {
    const cidrs = await fetchVPNRanges();
    matcher = new CIDRMatcher(cidrs);
    lastLoad = Date.now();
    console.log(`✅ VPN matcher ready (${cidrs.length} CIDRs)`);
  } catch (err) {
    console.error("❌ VPN matcher failed to load:", err);
    matcher = null;
  }
};

// initial load
loadMatcher();

// refresh daily
setInterval(loadMatcher, REFRESH_INTERVAL);

// ─────────────────────────────────────────────
// IP CHECK HELPERS
// ─────────────────────────────────────────────
const isSafeIP = (ip: string): boolean => {
  return SAFE_PREFIXES.some(prefix => ip.startsWith(prefix));
};

const isVPNIP = (ip: string): boolean => {
  if (!matcher) return false;
  try {
    return matcher.contains(ip);
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────
// GET CLIENT IP
// ─────────────────────────────────────────────
const getClientIP = (req: Request): string => {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();

  const real = req.headers["x-real-ip"];
  if (real) return String(real).trim();

  return req.socket.remoteAddress || "unknown";
};

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
export const blockCommercialVPN = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (env.NODE_ENV === "development") return next();

  // allow health checks ALWAYS
  if (req.path === "/" || req.path === "/health") return next();

  const ip = getClientIP(req);

  // never block safe infrastructure
  if (ip === "unknown" || isSafeIP(ip)) {
    return next();
  }

  // if matcher not ready → fail open
  if (!matcher) {
    console.warn("⚠️ VPN matcher not ready → allowing request");
    return next();
  }

  const vpn = isVPNIP(ip);

  if (vpn) {
    console.warn(`🚫 VPN BLOCKED: ${ip} | ${req.method} ${req.path}`);

    return res.status(403).json({
      success: false,
      error: "VPN or proxy connections are not allowed.",
      code: "COMMERCIAL_VPN_BLOCKED",
    });
  }

  next();
};