import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';

// Configure AWS S3 (if using cloud storage)
const s3Client = process.env.AWS_ACCESS_KEY_ID ? new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}) : null;

// File filter for videos
const videoFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'video/mp4',
    'video/avi',
    'video/mov',
    'video/wmv',
    'video/flv',
    'video/webm',
    'video/mkv',
    'video/m4v',
    'video/3gp',
    'video/quicktime',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only video files are allowed.'), false);
  }
};

// File filter for images (thumbnails)
const imageFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'), false);
  }
};

// Generate unique filename
const generateFileName = (originalname) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(16).toString('hex');
  const extension = path.extname(originalname);
  return `${timestamp}-${randomString}${extension}`;
};

// Local storage configuration
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = file.mimetype.startsWith('video/') ? 'uploads/videos' : 'uploads/images';
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, generateFileName(file.originalname));
  },
});

// S3 storage configuration
const s3Storage = s3Client ? multerS3({
  s3: s3Client,
  bucket: process.env.AWS_S3_BUCKET,
  metadata: (req, file, cb) => {
    cb(null, {
      fieldName: file.fieldname,
      userId: req.user?.id || 'anonymous',
      uploadTime: new Date().toISOString(),
    });
  },
  key: (req, file, cb) => {
    const folder = file.mimetype.startsWith('video/') ? 'videos' : 'images';
    const filename = generateFileName(file.originalname);
    cb(null, `${folder}/${filename}`);
  },
  contentType: multerS3.AUTO_CONTENT_TYPE,
}) : null;

// Choose storage based on configuration
const storage = s3Client ? s3Storage : localStorage;

// Video upload middleware
export const uploadVideo = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024, // 500MB default
  },
}).single('video');

// Image upload middleware
export const uploadImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
}).single('image');

// Multiple files upload
export const uploadMultiple = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video and image files are allowed.'), false);
    }
  },
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024,
    files: 10, // Maximum 10 files
  },
}).array('files', 10);

// Error handling middleware for upload errors
export const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        status: false,
        message: 'File too large',
        maxSize: process.env.MAX_FILE_SIZE || '500MB',
      });
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        status: false,
        message: 'Too many files',
        maxFiles: 10,
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        status: false,
        message: 'Unexpected field name',
      });
    }
  }

  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }

  logger.error('Upload error:', error);
  res.status(500).json({
    status: false,
    message: 'Upload failed',
  });
};

// Middleware to validate file upload
export const validateUpload = (req, res, next) => {
  if (!req.file && !req.files) {
    return res.status(400).json({
      status: false,
      message: 'No file uploaded',
    });
  }
  
  next();
};

// Middleware to log upload info
export const logUpload = (req, res, next) => {
  if (req.file) {
    logger.info(`File uploaded: ${req.file.originalname} (${req.file.size} bytes) by user ${req.user?.id || 'anonymous'}`);
  }
  
  if (req.files && req.files.length > 0) {
    const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);
    logger.info(`${req.files.length} files uploaded (${totalSize} bytes total) by user ${req.user?.id || 'anonymous'}`);
  }
  
  next();
};
