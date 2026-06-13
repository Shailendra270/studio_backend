import express from 'express';
import { body, param, query } from 'express-validator';
import {
  getTagsByCategoryAndType,
  createTag,
  updateTag,
  deleteTag,
  getTagById,
  bulkCreateTags
} from '../controllers/tagsController.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';

const router = express.Router();

// Validation middleware
const validateCreateTag = [
  body('category')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Category must be a non-empty string'),
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('tagType')
    .isIn(['event', 'player'])
    .withMessage('TagType must be either event or player'),
  // body('streamId')
  //   .optional()
  //   .isString()
  //   .withMessage('StreamId must be a string'),
  body('metaData.playerName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Player name must be between 1 and 100 characters'),
  body('metaData.jerseyNumber')
    .optional()
    .isString()
    .withMessage('Jersey number must be a string')
];

const validateUpdateTag = [
  param('id')
    .isMongoId()
    .withMessage('Invalid tag ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('metaData.playerName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Player name must be between 1 and 100 characters'),
  body('metaData.jerseyNumber')
    .optional()
    .isString()
    .withMessage('Jersey number must be a string')
];

const validateGetTags = [
  query('category')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Category must be a non-empty string'),
  query('tagType')
    .isIn(['event', 'player'])
    .withMessage('TagType must be either event or player'),
  query('search').optional().isString(),
  query('limit').optional().isInt({ min: 1 }),
  query('pageNo').optional().isInt({ min: 1 }),
  // query('streamId')
  //   .optional()
  //   .isString()
  //   .withMessage('StreamId must be a string')
];

const validateTagId = [
  param('id')
    .isMongoId()
    .withMessage('Invalid tag ID')
];

const validateBulkCreate = [
  body('tags')
    .isArray({ min: 1 })
    .withMessage('Tags must be a non-empty array'),
  body('tags.*.category')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Category must be a non-empty string'),
  body('tags.*.name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('tags.*.tagType')
    .isIn(['event', 'player'])
    .withMessage('TagType must be either event or player')
];

// Routes — Tags module
router.get('/', protect, requirePermission('Tags', 'view'), validateGetTags, getTagsByCategoryAndType);
router.get('/:id', protect, requirePermission('Tags', 'view'), validateTagId, getTagById);
router.post('/', protect, requirePermission('Tags', 'create'), validateCreateTag, createTag);
router.post('/bulk', protect, requirePermission('Tags', 'create'), validateBulkCreate, bulkCreateTags);

router.post('/import-players', optionalAuth, [
  body('teamId').isString().trim().isLength({ min: 1 }).withMessage('teamId is required'),
  body('seasonId').optional().isString().withMessage('seasonId must be string'),
  body('category').optional().isString(),
], async (req, res, next) => {
  const { validationResult } = await import('express-validator');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
  }
  const { importPlayersFromDSG } = await import('../controllers/tagsController.js');
  return importPlayersFromDSG(req, res, next);
});

router.put('/:id', protect, requirePermission('Tags', 'edit'), validateUpdateTag, updateTag);
router.delete('/:id', protect, requirePermission('Tags', 'delete'), validateTagId, deleteTag);

export default router;
