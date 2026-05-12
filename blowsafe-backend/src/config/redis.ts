// src/config/redis.ts — UPDATED initRedis() function
export async function initRedis(): Promise<{ pub: RedisClientType; sub: RedisClientType }> {
  if (isInitialized && pubClient?.isOpen && subClient?.isOpen) {
    return { pub: pubClient!, sub: subClient! };
  }

  const redisUrl = env.REDIS_URL || 'redis://localhost:6379';
  const isProd = env.NODE_ENV === 'production';
  
  // 🔐 Detect Render's rediss:// (TLS) URL and parse correctly
  const isTLS = redisUrl.startsWith('rediss://');
  const urlObj = new URL(redisUrl.replace('rediss://', 'redis://')); // Parse safely

  try {
    // ── Create PUB client ──────────────────────────────────────────────
    pubClient = createClient({
      url: redisUrl,
      // ✅ Explicit TLS config for Render/Upstash/Redis Cloud
      socket: isTLS ? {
        tls: true,
        rejectUnauthorized: true, // ✅ Verify certs (Render's are valid)
        reconnectStrategy: (retries: number) => {
          const delay = Math.min(retries * 1000, 30000);
          console.log(`🔁 Redis reconnect attempt ${retries} in ${delay}ms`);
          return delay;
        },
        connectTimeout: 10000,
      } : {
        // Non-TLS (local dev)
        reconnectStrategy: (retries: number) => Math.min(retries * 1000, 30000),
        connectTimeout: 5000,
      },
      disableOfflineQueue: true,
    });

    subClient = pubClient.duplicate();

    // ── Event listeners ───────────────────────────────────────────────
    const setupListeners = (client: RedisClientType, label: string) => {
      client.on('error', (err) => {
        // ⚠️ Don't spam logs on transient errors in prod
        if (isProd && (err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT'))) {
          console.warn(`⚠️ Redis ${label} transient error:`, err.message);
        } else {
          console.error(`❌ Redis ${label} error:`, err.message);
        }
      });
      client.on('connect', () => {
        const safeUrl = redisUrl.replace(/:[^:@]+@/, ':***@');
        console.log(`✅ Redis ${label} connected: ${safeUrl}`);
      });
      client.on('ready', () => console.log(`🟢 Redis ${label} ready`));
      client.on('end', () => console.log(`🔌 Redis ${label} connection ended`));
    };

    setupListeners(pubClient, 'PUB');
    setupListeners(subClient, 'SUB');

    // ── Connect with timeout guard ────────────────────────────────────
    const connectWithTimeout = (client: RedisClientType, timeoutMs: number) => {
      return Promise.race([
        client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Redis connect timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
    };

    await Promise.all([
      connectWithTimeout(pubClient, isProd ? 15000 : 5000),
      connectWithTimeout(subClient, isProd ? 15000 : 5000),
    ]);

    // Health check
    await pubClient.ping();
    console.log('✅ Redis health check: PONG');

    isInitialized = true;
    return { pub: pubClient, sub: subClient };

  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    
    // 🟡 Dev fallback: mock clients
    if (!isProd) {
      console.warn('⚠️ Running without Redis (dev fallback). Real-time features will be local-only.');
      const mockClient = createMockRedisClient();
      return { pub: mockClient, sub: mockClient };
    }
    
    // 🔴 Prod: throw so we notice, but don't crash the whole server
    // (Caller in index.ts handles fallback)
    throw new Error(`Redis initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Helper: Create mock Redis client for dev fallback ─────────────────
function createMockRedisClient(): RedisClientType {
  const mock = {
    isOpen: false,
    connect: async () => { mock.isOpen = true; },
    quit: async () => { mock.isOpen = false; },
    duplicate: () => mock,
    on: () => {},
    off: () => {},
    ping: async () => 'PONG',
    publish: async () => 0,
    subscribe: async () => {},
    unsubscribe: async () => {},
    // Add other methods Socket.IO adapter might call
    set: async () => 'OK',
    get: async () => null,
    del: async () => 0,
  } as unknown as RedisClientType;
  return mock;
}