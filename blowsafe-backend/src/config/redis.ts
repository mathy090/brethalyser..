/**
 * blowsafe-backend/src/config/redis.ts
 *
 * Redis client setup for Socket.IO adapter + general caching.
 * - Uses official 'redis' v4+ client (compatible with @socket.io/redis-adapter)
 * - Returns separate pub/sub clients for adapter pattern
 * - Graceful reconnect + error handling
 * - Works with Bun, Node, and Render
 */

import { createClient, type RedisClientType } from 'redis';
import { env } from './env';

let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;
let isInitialized = false;

export async function initRedis(): Promise<{ pub: RedisClientType; sub: RedisClientType }> {
  // Prevent duplicate initialization
  if (isInitialized && pubClient?.isOpen && subClient?.isOpen) {
    return { pub: pubClient!, sub: subClient! };
  }

  const redisUrl = env.REDIS_URL || 'redis://localhost:6379';
  const isProd = env.NODE_ENV === 'production';

  try {
    // ── Create PUB client (for emitting events) ──────────────────────────────
    pubClient = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          // Exponential backoff: 1s, 2s, 4s... max 30s
          const delay = Math.min(retries * 1000, 30000);
          console.log(`🔁 Redis reconnect attempt ${retries} in ${delay}ms`);
          return delay;
        },
        connectTimeout: 10000,
      },
      // Optional: disable offline queue to avoid memory buildup during outages
      disableOfflineQueue: true,
    });

    // ── Create SUB client (for receiving broadcasts) ─────────────────────────
    subClient = pubClient.duplicate();

    // ── Event listeners (both clients) ───────────────────────────────────────
    const setupListeners = (client: RedisClientType, label: string) => {
      client.on('error', (err) => {
        console.error(`❌ Redis ${label} error:`, err.message);
      });
      client.on('connect', () => {
        console.log(`✅ Redis ${label} connected: ${redisUrl.replace(/:[^:@]+@/, ':***@')}`);
      });
      client.on('ready', () => {
        console.log(`🟢 Redis ${label} ready`);
      });
      client.on('end', () => {
        console.log(`🔌 Redis ${label} connection ended`);
      });
      if (isProd) {
        client.on('reconnecting', () => {
          console.log(`🔄 Redis ${label} reconnecting...`);
        });
      }
    };

    setupListeners(pubClient, 'PUB');
    setupListeners(subClient, 'SUB');

    // ── Connect both clients ─────────────────────────────────────────────────
    await pubClient.connect();
    await subClient.connect();

    // ── Health check (optional but recommended) ──────────────────────────────
    await pubClient.ping();
    console.log('✅ Redis health check: PONG');

    isInitialized = true;
    return { pub: pubClient, sub: subClient };

  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    
    // ⚠️ Graceful fallback: return mock clients for local dev without Redis
    if (!isProd) {
      console.warn('⚠️ Running without Redis (dev fallback). Real-time features will be local-only.');
      // Return minimal mock clients that won't crash Socket.IO adapter init
      const mockClient = {
        isOpen: false,
        connect: async () => {},
        quit: async () => {},
        duplicate: () => mockClient,
        on: () => {},
        off: () => {},
        ping: async () => 'PONG',
        // Add other methods Socket.IO adapter might call (no-ops)
        publish: async () => 0,
        subscribe: async () => {},
        unsubscribe: async () => {},
      } as unknown as RedisClientType;
      return { pub: mockClient, sub: mockClient };
    }
    
    // In production, fail fast — Redis is required for scaling
    throw new Error(`Redis initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function closeRedis(): Promise<void> {
  try {
    if (subClient?.isOpen) {
      await subClient.quit();
      console.log('🔌 Redis SUB client closed');
    }
    if (pubClient?.isOpen && pubClient !== subClient) {
      await pubClient.quit();
      console.log('🔌 Redis PUB client closed');
    }
    isInitialized = false;
  } catch (err) {
    console.error('⚠️ Error closing Redis:', err);
  }
}

// ── Optional: Helper for general Redis operations (caching, etc.) ────────────
export async function getRedisClient(): Promise<RedisClientType> {
  if (!pubClient?.isOpen) {
    await initRedis();
  }
  return pubClient!;
}