import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, query } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { chat, history } from '../controllers/chatController.js';

const router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: {
    status: false,
    message: 'Too many chat requests. Please wait a moment and try again.',
  },
});

router.use(protect);

router.post(
  '/',
  chatLimiter,
  [
    body('message')
      .isString()
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage('message must be between 1 and 2000 characters'),
    body('threadId')
      .optional({ nullable: true, checkFalsy: true })
      .isMongoId()
      .withMessage('threadId must be a valid Mongo ID'),
    body('locale').optional().isString().isLength({ max: 20 }).withMessage('locale is invalid'),
  ],
  chat,
);

router.get(
  '/history',
  chatLimiter,
  [
    query('threadId')
      .optional({ nullable: true, checkFalsy: true })
      .isMongoId()
      .withMessage('threadId must be a valid Mongo ID'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1..100'),
  ],
  history,
);

export default router;
