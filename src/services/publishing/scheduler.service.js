import { Queue } from 'bullmq';
import dotenv from 'dotenv';

dotenv.config();

const getRedisConnection = () => {
  let config = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
  };

  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      config = {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: url.username,
        password: url.password,
      };
    } catch (e) {
      console.error('Invalid REDIS_URL', e);
    }
  }

  // Fix for ECONNREFUSED ::1:6379 (IPv6 localhost issue)
  if (config.host === 'localhost') {
    config.host = '127.0.0.1';
  }

  return config;
};

let socialQueue;

export const getSocialQueue = () => {
  if (!socialQueue) {
    const connection = getRedisConnection();
    console.log('Initializing Social Queue with connection:', { ...connection, password: connection.password ? '***' : undefined });
    socialQueue = new Queue('social_publish', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 10s, 20s
        },
        removeOnComplete: true,
        removeOnFail: false, // Keep failed for inspection
      },
    });
    
    socialQueue.on('error', (err) => {
      console.error('Social Queue Error:', err);
    });
  }
  return socialQueue;
};

class SchedulerService {
  /**
   * Schedule a publishing job
   * @param {Object} data - Job data (eventId, payload, profileKey)
   * @param {Date} [publishAt] - Scheduled time
   * @returns {Promise<import('bullmq').Job>}
   */
  async schedule(data, publishAt) {
    console.log('SchedulerService: Scheduling job...', { eventId: data.eventId, publishAt });
    const opts = {};
    if (publishAt) {
      const delay = new Date(publishAt).getTime() - Date.now();
      if (delay > 0) {
        opts.delay = delay;
      }
    }

    try {
      const queue = getSocialQueue();
      console.log('SchedulerService: Adding job to queue...');
      const job = await queue.add('publish', data, opts);
      console.log('SchedulerService: Job added successfully:', job.id);
      return job;
    } catch (error) {
      console.error('SchedulerService: Failed to schedule job:', error);
      throw error;
    }
  }
}

export default new SchedulerService();
