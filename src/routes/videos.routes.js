import express from 'express';
import { body, query, param } from 'express-validator';
import {
  uploadVideo,
  getVideos,
  getVideoById,
  updateVideo,
  deleteVideo,
  trimVideo,
  downloadVideo,
  getVideoProcessingStatus,
} from '../controllers/videos.controller.js';
import { protect, optionalAuth, checkStorageLimit } from '../middleware/auth.js';
import { 
  uploadVideo as uploadVideoMiddleware, 
  handleUploadError, 
  logUpload 
} from '../middleware/upload.middleware.js';

const router = express.Router();

// Validation rules
const uploadValidation = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title must be between 1 and 255 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Description must not exceed 5000 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('visibility')
    .optional()
    .isIn(['public', 'private', 'unlisted'])
    .withMessage('Visibility must be public, private, or unlisted'),
];

const updateValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title must be between 1 and 255 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Description must not exceed 5000 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('visibility')
    .optional()
    .isIn(['public', 'private', 'unlisted'])
    .withMessage('Visibility must be public, private, or unlisted'),
];

const trimValidation = [
  body('start_time')
    .isFloat({ min: 0 })
    .withMessage('Start time must be a non-negative number'),
  body('end_time')
    .isFloat({ min: 0 })
    .withMessage('End time must be a non-negative number'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title must be between 1 and 255 characters'),
];

const queryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['uploading', 'processing', 'ready', 'failed', 'deleted'])
    .withMessage('Invalid status'),
  query('visibility')
    .optional()
    .isIn(['public', 'private', 'unlisted'])
    .withMessage('Invalid visibility'),
  query('sort')
    .optional()
    .isIn(['created_at', 'updated_at', 'title', 'duration', 'view_count'])
    .withMessage('Invalid sort field'),
  query('order')
    .optional()
    .isIn(['ASC', 'DESC'])
    .withMessage('Order must be ASC or DESC'),
];

const idValidation = [
  param('id')
    .notEmpty()
    .withMessage('Video ID is required'),
];

// Routes

// Upload video
router.post('/upload', 
  protect,
  checkStorageLimit,
  uploadVideoMiddleware,
  handleUploadError,
  logUpload,
  uploadValidation,
  uploadVideo
);

// Get user's videos
router.get('/', 
  protect,
  queryValidation,
  getVideos
);

// Get video by ID (public endpoint with optional auth)
router.get('/:id',
  idValidation,
  optionalAuth,
  getVideoById
);

// Update video
router.put('/:id',
  idValidation,
  protect,
  updateValidation,
  updateVideo
);

// Delete video
router.delete('/:id',
  idValidation,
  protect,
  deleteVideo
);

// Trim video
router.post('/:id/trim',
  idValidation,
  protect,
  trimValidation,
  trimVideo
);

// Download video
router.get('/:id/download',
  idValidation,
  optionalAuth,
  downloadVideo
);

// Get video processing status
router.get('/:id/status',
  idValidation,
  protect,
  getVideoProcessingStatus
);

export default router;
