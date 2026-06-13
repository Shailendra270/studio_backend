import winston from "winston";
import path from "path";
import fs from "fs";

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Custom format for file output
const fileFormat = combine(timestamp(), errors({ stack: true }), json());

// Detect Vercel/serverless environment (no writable filesystem for logs/)
const isVercel = !!process.env.VERCEL;

// Configure transports based on environment
const transports = [];


// File-based logging only when not running on Vercel (e.g. GCP, local)
if (!isVercel) {
  const logsDir = "logs";
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Error log - only errors
  transports.push(
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: fileFormat,
    }),
  );

  // Combined log - all levels
  transports.push(
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: fileFormat,
    }),
  );
}

// Console logging:
// - always in development
// - always on Vercel (even in production) since file logging is disabled there
if (process.env.NODE_ENV !== "production" || isVercel) {
  transports.push(
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        consoleFormat,
      ),
    }),
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: fileFormat,
  defaultMeta: {
    service: "zentag-backend",
    environment: process.env.NODE_ENV || "development",
  },
  transports,
});

// Add request logging helper
logger.logRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    responseTime: `${responseTime}ms`,
    statusCode: res.statusCode,
    contentLength: res.get("Content-Length") || 0,
  };

  if (res.statusCode >= 400) {
    logger.warn("HTTP Request", logData);
  } else {
    logger.info("HTTP Request", logData);
  }
};

// Add error logging helper
logger.logError = (error, req = null) => {
  const logData = {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
  };

  if (req) {
    logData.request = {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      body: req.body,
      params: req.params,
      query: req.query,
    };
  }

  logger.error("Application Error", logData);
};

export default logger;
