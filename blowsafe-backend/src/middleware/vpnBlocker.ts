// blowsafe-backend/src/middleware/vpnBlocker.ts
import { Request, Response, NextFunction } from 'express';
import ipaddr from 'ipaddr.js';
import axios from 'axios';
import { env } from '../config/env';

// Free, open-source commercial VPN IPv4 CIDR list (updated weekly by community)
const VPN_LIST_URL = 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/vpn/ipv4.txt';

interface CIDRNetwork {
  ip: ipaddr.IPv4;
  mask: number;
}

let vpnNetworks: CIDRNetwork[] = [];
let isLoading = false;
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch & parse free commercial VPN IP ranges into memory
 */
const fetchVPNList = async () => {
  if (isLoading) return;
  isLoading = true;
  
  try {
    console.log('🔄 Loading free commercial VPN IP ranges...');
    const { data } = await axios.get(VPN_LIST_URL, { timeout: 5000 });
    const lines = data.split('\n');
    const networks: CIDRNetwork[] = [];
    
    for (const line of lines) {
      const cidr = line.trim();
      if (cidr && !cidr.startsWith('#') && cidr.includes('/')) {
        try {
          const [ip, mask] = ipaddr.parseCIDR(cidr);
          networks.push({ ip: ip as ipaddr.IPv4, mask });
        } catch {
          // Skip malformed lines
        }
      }
    }
    
    vpnNetworks = networks;
    console.log(`✅ VPN Blocker: Loaded ${vpnNetworks.length} commercial VPN ranges`);
  } catch (err) {
    console.error('⚠️ VPN List fetch failed (fail-open):', err);
  } finally {
    isLoading = false;
  }
};

// Auto-refresh every 24 hours
setInterval(fetchVPNList, REFRESH_INTERVAL);
// Initial load on startup
fetchVPNList();

/**
 * Check if an IP falls within any commercial VPN range
 */
const isCommercialVPN = (clientIP: string): boolean => {
  try {
    const addr = ipaddr.parse(clientIP);
    if (addr.kind() !== 'ipv4') return false;
    
    // Fast CIDR match against all loaded ranges
    return vpnNetworks.some(network => addr.match(network.ip, network.mask));
  } catch {
    return false;
  }
};

/**
 * Extract real client IP behind proxies/load balancers
 */
const getClientIP = (req: Request): string => {
  if (req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']);
  if (req.headers['x-forwarded-for']) {
    const ips = String(req.headers['x-forwarded-for']).split(',');
    return ips[0].trim();
  }
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  return req.socket.remoteAddress || 'unknown';
};

/**
 * Express middleware: Block commercial VPN/Proxy connections
 * Mounted at app level → runs on EVERY request (including /register)
 */
export const blockCommercialVPN = async (req: Request, res: Response, next: NextFunction) => {
  // Skip in development to avoid blocking localhost/testing
  if (env.NODE_ENV === 'development') return next();

  const ip = getClientIP(req);
  
  // Skip private/local IPs
  if (ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('192.168.') || 
      ip.startsWith('10.') || ip.startsWith('172.16.') || ip.startsWith('172.17.')) {
    return next();
  }

  // Wait up to 3s for initial list load if not ready
  if (vpnNetworks.length === 0) {
    if (!isLoading) {
      console.warn('⚠️ VPN list not loaded yet. Allowing request (fail-open).');
      return next();
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Block if IP matches commercial VPN range
  if (vpnNetworks.length > 0 && isCommercialVPN(ip)) {
    return res.status(403).json({
      success: false,
      error: 'Commercial VPN/Proxy connections are not permitted.',
      message: 'Please disconnect your VPN and try again. If you believe this is an error, contact support.',
      code: 'COMMERCIAL_VPN_BLOCKED'
    });
  }

  next();
};