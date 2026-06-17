import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Import routes
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import videoRoutes from './routes/videos.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import streamsRoutes from './routes/streams.routes.js';
import clipRoutes from './routes/clipRoutes.js';
import folderRoutes from './routes/folderRoutes.js';
import assetsRoutes from './routes/assets.routes.js';
import tagsRoutes from './routes/tags.routes.js';
import templatesRoutes from './routes/templates.routes.js';
import prestreamRoutes from './routes/prestream.routes.js';
import emailRoutes from './routes/email.routes.js';
import socialRoutes from './routes/social.routes.js';
import cloudRoutes from './routes/cloud.routes.js';
import competitionsRoutes from './routes/competitions.routes.js';
import organizationRoutes from './routes/organization.routes.js';
import mediaLibraryRoutes from './routes/mediaLibrary.routes.js';
import auditLogsRoutes from './routes/auditLogs.routes.js';
import chatRoutes from './routes/chat.routes.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import logger from './utils/logger.js';
import { requestTracking, requestAuditLogger } from './middleware/requestAudit.js';

const app = express();

// Trust proxy for accurate client IP
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Compression middleware
app.use(compression());

// Rate limiting
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // limit each IP to 100 requests per windowMs
//   message: {
//     error: 'Too many requests from this IP, please try again later.',
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
// });
// app.use(limiter);

// Auth rate limiting (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
});

// CORS configuration
const allowedOrigins = [
  'https://studio.zentag.ai',
  'https://zentag.ai',
  'https://zentag-ai-dev.vercel.app',
  'http://35.200.219.105',
  'http://3.26.94.215',
  'https://zentag.ai',
  process.env.FRONTEND_URL,
].filter(Boolean);

// app.use(
//   cors({
//     origin: (origin, callback) => callback(null, origin || "*"),
//     credentials: true,
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
//     exposedHeaders: ['X-Total-Count'],
//   })
// );

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow mobile apps/curl
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        return callback(null, true);
      }
      return callback(new Error(`❌ CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['X-Total-Count'],
  })
);

// app.use(
//   cors({
//     origin: (origin, callback) => {
//       // Allow requests with no origin (like mobile apps or curl requests)
//       if (!origin) return callback(null, true);
      
//       // Check if origin is in allowed list
//       if (allowedOrigins.includes(origin)) {
//         return callback(null, true);
//       }
      
//       // For development, allow any localhost origin
//       if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
//         return callback(null, true);
//       }
      
//       logger.warn(`CORS blocked origin: ${origin}`);
//       return callback(new Error('Not allowed by CORS'));
//     },
//     credentials: true,
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
//     exposedHeaders: ['X-Total-Count'],
//   })
// );

// Logging middleware

app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));
app.use(requestTracking);
app.use(requestAuditLogger);

// Body parsing middleware
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '50mb' 
}));
app.use(cookieParser());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "Zentag API Running ✅",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/streams', streamsRoutes);
app.use('/api/clips', clipRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/auth/templates', templatesRoutes);
app.use('/api/prestream-templates', prestreamRoutes);
app.use('/api/auth/prestream-templates', prestreamRoutes);
// app.use('/api/email', emailRoutes);
// app.use('/api/auth/email', emailRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/auth/social', socialRoutes);
app.use('/api/cloud', cloudRoutes);
app.use('/api/auth/cloud', cloudRoutes);
app.use('/api/competitions', competitionsRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/media-library', mediaLibraryRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/chat', chatRoutes);

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handler
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

export default app;
