import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PublishEvent from '../../models/PublishEvent.js';
import AyrshareService from './ayrshare.service.js';
import { PublishErrorType } from '../../config/platform.rules.js';

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

let worker;

export const initWorker = () => {
  if (worker) return worker;

  const connection = getRedisConnection();
  console.log('Initializing Social Worker with connection:', { ...connection, password: connection.password ? '***' : undefined });

  worker = new Worker('social_publish', async (job) => {
    const { eventId, payload, profileKey } = job.data;
    console.log(payload,"here..............");
    
    try {
      const event = await PublishEvent.findById(eventId);
      if (!event) {
        throw new Error(`Event not found: ${eventId}`);
      }

      console.log(`Processing publish event ${eventId} for platform ${payload.platforms[0]}`);

      const response = await AyrshareService.post(payload, profileKey);

      // Update event with success
      event.status = response.status === 'success' || response.status === 'scheduled' ? 
        (response.status === 'scheduled' ? 'scheduled' : 'completed') : 'failed';
      
      event.ayrshareRefId = response.refId || response.id; // Ayrshare returns refId or id
      event.platformPostId = response.id; // Sometimes different
      event.postUrl = response.postIds?.[0]?.postUrl || response.postUrl;
      event.ayrshareResponse = response;
      event.publishedAt = new Date();

      await event.save();
      return response;

    } catch (error) {
      console.error(`Job failed for event ${eventId}:`, error);
      
      // Update event with failure
      const event = await PublishEvent.findById(eventId);
      if (event) {
        event.status = 'failed';
        event.errorMessage = error.message;
        event.retryCount = (event.retryCount || 0) + 1;
        event.ayrshareResponse = error.response?.data || error.details; // Store error details
        await event.save();
      }

      // BullMQ will handle retries based on queue settings
      // We can throw specific errors to control retry behavior if needed
      throw error;
    }
  }, {
    connection,
    concurrency: 5, // Process 5 concurrent jobs
    limiter: {
      max: 10, // Max 10 jobs
      duration: 1000, // per 1 second (Global rate limit for Ayrshare API)
    },
  });

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed!`);
  });

  worker.on('failed', (job, err) => {
    console.log(`Job ${job.id} failed with ${err.message}`);
  });

  return worker;
};

export default initWorker;
