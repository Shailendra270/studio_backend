import dotenv from 'dotenv';
import mongoose from 'mongoose';
import app from './app.js';
import { initSocket } from './socket/index.js';
import logger from './utils/logger.js';
import { connectRedis } from './utils/redis.js';
import { initWorker } from './services/publishing/publish.worker.js';

// Load environment variables from root .env
dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const NODE_ENV = process.env.NODE_ENV || "development";

// MongoDB connection options
const mongoOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  bufferCommands: true, // Enable buffering to prevent errors when DB is not connected
};

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, mongoOptions);
    logger.info("✅ MongoDB connected successfully");

    const dbName = mongoose.connection.db.databaseName;
    logger.info(`📊 Connected to database: ${dbName}`);
  } catch (error) {
    logger.error("❌ MongoDB connection error:", error.message);
    logger.warn("⚠️  Running in offline mode - some features may not work");

    // Don't exit - run server without database for testing
    return false;
  }
};

// MongoDB event listeners
mongoose.connection.on("connected", () => {
  logger.info("MongoDB connection established");
});

mongoose.connection.on("error", (err) => {
  logger.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected");
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);

  if (mongoose.connection.readyState === 1) {
    mongoose.connection.close(() => {
      logger.info("MongoDB connection closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
// src/server.js
console.log("Deploy Test");
// Start server
const startServer = async () => {
  try {
    // Try to connect to database
    const dbConnected = await connectDB();
    
    // Temporarily disable Redis for debugging
    /*
    try {
      await connectRedis();
      initWorker(); // Start Social Worker only after Redis is connected
      logger.info('👷 Social Worker started');
    } catch (e) {
      logger.warn('Redis connection failed, some features may be disabled');
    }
    */
    logger.warn('⚠️  Redis disabled by manual override');
    
    // Start HTTP server regardless of database connection
    const server = app.listen(PORT, "0.0.0.0", async () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${NODE_ENV}`);
      logger.info(`📱 API Base URL: http://localhost:${PORT}`);
      logger.info(`🔗 Test API: http://localhost:${PORT}/health`);

      if (dbConnected) {
        logger.info(`✅ Database: Connected and ready`);
      } else {
        logger.warn(`⚠️  Database: Running in offline mode`);
      }

      logger.info(`\n🧪 Test the API endpoints:`);
      logger.info(`   GET  http://localhost:${PORT}/health`);
      logger.info(`   POST http://localhost:${PORT}/api/auth/signup`);
      logger.info(`   POST http://localhost:${PORT}/api/auth/login`);

      try {
        await initSocket(server);
      } catch (e) {
        logger.error(`❌ Socket.io init failed: ${e?.message || e}`);
      }
    });

    // Handle server errors
    server.on("error", (error) => {
      if (error.syscall !== "listen") {
        throw error;
      }

      const bind = typeof PORT === "string" ? "Pipe " + PORT : "Port " + PORT;

      switch (error.code) {
        case "EACCES":
          logger.error(`${bind} requires elevated privileges`);
          process.exit(1);
          break;
        case "EADDRINUSE":
          logger.error(`${bind} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    });

    return server;
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
