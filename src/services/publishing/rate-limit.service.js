import redisClient from '../../utils/redis.js';
import { PublishErrorType, PlatformRules } from '../../config/platform.rules.js';

class RateLimitService {
  /**
   * Check and increment rate limit for a user/platform
   * @param {string} userId
   * @param {string} platform
   * @throws {Error} - Throws RATE_LIMIT error if exceeded
   */
  async checkAndIncrement(userId, platform) {
    if (!redisClient.isReady) {
      console.warn('Redis client is not ready, skipping rate limit check');
      return;
    }

    if (platform === 'tiktok') {
      const dailyKey = `rate_limit:tiktok:daily:${userId}`;
      const minuteKey = `rate_limit:tiktok:minute:${userId}`;
      
      const dailyLimit = PlatformRules.TIKTOK.RATE_LIMITS.POSTS_PER_DAY;
      const minuteLimit = PlatformRules.TIKTOK.RATE_LIMITS.POSTS_PER_MINUTE;

      try {
        // Check Daily Limit
        const dailyCurrent = await redisClient.incr(dailyKey);
        if (dailyCurrent === 1) {
          await redisClient.expire(dailyKey, 86400); // 24 hours
        }

        if (dailyCurrent > dailyLimit) {
          const error = new Error(`TikTok daily limit of ${dailyLimit} posts reached.`);
          error.type = PublishErrorType.RATE_LIMIT;
          throw error;
        }

        // Check Minute Limit
        const minuteCurrent = await redisClient.incr(minuteKey);
        if (minuteCurrent === 1) {
          await redisClient.expire(minuteKey, 60); // 1 minute
        }

        if (minuteCurrent > minuteLimit) {
          const error = new Error(`TikTok per-minute limit of ${minuteLimit} posts reached. Please slow down.`);
          error.type = PublishErrorType.RATE_LIMIT;
          throw error;
        }

      } catch (redisError) {
        // Fallback or log if Redis fails
        console.error('RateLimitService Redis Error:', redisError);
        // If Redis fails, we might allow or block based on policy. usually allow to avoid blocking user.
        if (redisError.type === PublishErrorType.RATE_LIMIT) throw redisError;
      }
    }
    
    // Other platform limits if needed
  }
}

export default new RateLimitService();
