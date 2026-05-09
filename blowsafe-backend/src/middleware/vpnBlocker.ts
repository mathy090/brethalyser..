// blowsafe-backend/src/middleware/vpnBlocker.ts

import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import CIDRMatcher from 'cidr-matcher';
import { env } from '../config/env';

// VPN + Datacenter intelligence feeds
const VPN_LIST_URLS = [
  'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt',
  'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt',
  'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level2.netset',
];

// Minimal emergency fallback
const BUILTIN_VPN_RANGES = [
  '185.220.100.0/22',
  '104.244.76.0/24',
  '185.220.102.0/24',
];

let matcher = new CIDRMatcher([]);
let loadedRanges = 0;

let isLoading = false;
let lastLoadAttempt = 0;

const LOAD_COOLDOWN = 5 * 60 * 1000; // 5 mins
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Extract CIDRs from text response
 */
const extractCIDRs = (data: string): string[] => {
  const cidrs: string[] = [];

  const lines = data.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('!') ||
      trimmed.startsWith(';')
    ) {
      continue;
    }

    const match = trimmed.match(
      /(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})/
    );

    if (match?.[1]) {
      cidrs.push(match[1]);
    }
  }

  return cidrs;
};

/**
 * Fetch VPN lists from all providers
 */
const fetchVPNRanges = async (): Promise<string[]> => {
  const allRanges = new Set<string>();

  for (const url of VPN_LIST_URLS) {
    try {
      console.log(`🔄 Fetching VPN feed: ${url}`);

      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'BlowSafe-VPN-Blocker/2.0',
        },
      });

      const cidrs = extractCIDRs(data);

      cidrs.forEach(cidr => allRanges.add(cidr));

      console.log(`✅ Loaded ${cidrs.length} ranges from ${url}`);
    } catch (err) {
      console.warn(
        `⚠️ Failed loading ${url}:`,
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  // Fallback if all feeds failed
  if (allRanges.size === 0) {
    console.warn(
      `⚠️ All feeds failed. Using built-in fallback ranges.`
    );

    BUILTIN_VPN_RANGES.forEach(cidr => allRanges.add(cidr));
  }

  return Array.from(allRanges);
};

/**
 * Load CIDR matcher into memory
 */
const loadVPNMatcher = async () => {
  if (isLoading) return;

  const now = Date.now();

  // Prevent spam reloads
  if (now - lastLoadAttempt < LOAD_COOLDOWN) {
    return;
  }

  lastLoadAttempt = now;
  isLoading = true;

  try {
    const cidrs = await fetchVPNRanges();

    matcher = new CIDRMatcher(cidrs);

    loadedRanges = cidrs.length;

    console.log(
      `✅ VPN matcher loaded with ${loadedRanges} CIDR ranges`
    );
  } catch (err) {
    console.error(
      '❌ Failed loading VPN matcher:',
      err
    );
  } finally {
    isLoading = false;
  }
};

// Initial load
loadVPNMatcher();

// Auto refresh every 24h
setInterval(loadVPNMatcher, REFRESH_INTERVAL);

/**
 * Extract real client IP
 */
const getClientIP = (req: Request): string => {
  const cfIP = req.headers['cf-connecting-ip'];

  if (cfIP) {
    return String(cfIP).split(',')[0].trim();
  }

  const forwarded = req.headers['x-forwarded-for'];

  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }

  const realIP = req.headers['x-real-ip'];

  if (realIP) {
    return String(realIP).trim();
  }

  return req.socket.remoteAddress || 'unknown';
};

/**
 * Local/private IP detection
 */
const isPrivateIP = (ip: string): boolean => {
  return (
    ip === 'unknown' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.20.') ||
    ip.startsWith('172.21.') ||
    ip.startsWith('172.22.') ||
    ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') ||
    ip.startsWith('172.25.') ||
    ip.startsWith('172.26.') ||
    ip.startsWith('172.27.') ||
    ip.startsWith('172.28.') ||
    ip.startsWith('172.29.') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.')
  );
};

/**
 * Fast VPN/datacenter detection
 */
const isVPN = (ip: string): boolean => {
  try {
    return matcher.contains(ip);
  } catch {
    return false;
  }
};

/**
 * Middleware
 */
export const blockCommercialVPN = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Skip in development
  if (env.NODE_ENV === 'development') {
    return next();
  }

  const ip = getClientIP(req);

  // Allow private/local traffic
  if (isPrivateIP(ip)) {
    return next();
  }

  // Fail-open if matcher still loading
  if (loadedRanges === 0) {
    if (!isLoading) {
      loadVPNMatcher().catch(() => {});
    }

    console.warn(
      '⚠️ VPN matcher not ready. Allowing request (fail-open).'
    );

    return next();
  }

  // VPN / Datacenter match
  if (isVPN(ip)) {
    console.warn(
      `🚫 BLOCKED VPN/DATACENTER IP: ${ip} | ${req.method} ${req.path}`
    );

    return res.status(403).json({
      success: false,
      error:
        'Commercial VPN or datacenter connections are not permitted.',
      message:
        'Please disable your VPN/proxy and try again.',
      code: 'COMMERCIAL_VPN_BLOCKED',
    });
  }

  next();
};