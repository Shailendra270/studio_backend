import { Server } from "socket.io";
import { createClient } from "redis";
import dotenv from "dotenv";
import logger from "../utils/logger.js";

// Load environment variables from root .env
dotenv.config();

let io;

export const initSocket = async (server) => {
  const corsOrigin = process.env.SOCKET_CORS_ORIGIN || "*";
  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  try {
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const pubClient = createClient({ 
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            return new Error('Redis connection retries exhausted');
          }
          return Math.min(retries * 500, 3000);
        }
      }
    });
    const subClient = pubClient.duplicate();
    
    // Handle errors to prevent crash
    pubClient.on('error', (err) => logger.warn(`Redis Pub Client Error: ${err.message}`));
    subClient.on('error', (err) => logger.warn(`Redis Sub Client Error: ${err.message}`));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("✅ Redis adapter attached to Socket.io");
  } catch (e) {
    logger.warn(
      `⚠️ Redis adapter not available, running Socket.io without adapter: ${e?.message || e}`,
    );
  }

  io.on("connection", (socket) => {
    logger.info(`Socket connected: ${socket.id}`);
    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${socket.id} reason=${reason}`);
    });
    socket.on("error", (err) => {
      logger.error(`Socket error: ${err?.message || err}`);
    });
  });

  logger.info("✅ Socket.io initialized with Redis adapter");
  return io;
};

export const getIO = () => io;

export const emitWebhookUpdate = (payload) => {
  try {
    if (!io) return;
    io.emit("webhook-update", payload);
  } catch (e) {
    logger.error(`emitWebhookUpdate error: ${e?.message || e}`);
  }
};
