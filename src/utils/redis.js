import { createClient } from 'redis';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

const redisClient = createClient({
  url: (process.env.REDIS_URL || 'redis://127.0.0.1:6379').replace('localhost', '127.0.0.1'),
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        logger.error('Redis connection retries exhausted');
        return new Error('Redis connection retries exhausted');
      }
      return Math.min(retries * 500, 3000);
    }
  }
});

redisClient.on('error', (err) => {
  logger.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  logger.info('✅ Redis Client Connected');
});

redisClient.on('ready', () => {
  logger.info('📡 Redis Client Ready');
});

redisClient.on('end', () => {
  logger.info('📴 Redis Client Disconnected');
});

export const connectRedis = async () => {
  try {
    await redisClient.connect();
    logger.info('🔄 Redis connected successfully');
  } catch (error) {
    logger.error('❌ Redis connection failed:', error);
    throw error;
  }
};

// Cache utilities
export const setCache = async (key, value, expiration = 3600) => {
  try {
    await redisClient.setEx(key, expiration, JSON.stringify(value));
  } catch (error) {
    logger.error('Redis set error:', error);
  }
};

export const getCache = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error('Redis get error:', error);
    return null;
  }
};

export const deleteCache = async (key) => {
  try {
    await redisClient.del(key);
  } catch (error) {
    logger.error('Redis delete error:', error);
  }
};

export const flushCache = async () => {
  try {
    await redisClient.flushAll();
    logger.info('Redis cache flushed');
  } catch (error) {
    logger.error('Redis flush error:', error);
  }
};

export default redisClient;
