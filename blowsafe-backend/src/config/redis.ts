// src/config/redis.ts
import { createClient, type RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  
  redisClient = createClient({ 
    url,
    socket: {
      reconnectStrategy: (retries) => {
        // Exponential backoff: 1s, 2s, 4s, max 30s
        return Math.min(retries * 1000, 30000);
      },
    },
  });

  redisClient.on('error', (err) => {
    console.error('❌ Redis Client Error:', err.message);
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis connected:', url.replace(/:[^:@]+@/, ':***@'));
  });

  await redisClient.connect();
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    console.log('🔌 Redis disconnected');
  }
}