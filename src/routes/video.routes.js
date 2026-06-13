import express from 'express';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Basic video routes (to be expanded)
router.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Video routes - coming soon',
    data: []
  });
});

router.post('/upload', (req, res) => {
  res.json({
    status: 'success',
    message: 'Video upload endpoint - coming soon'
  });
});

router.post('/trim', (req, res) => {
  res.json({
    status: 'success',
    message: 'Video trim endpoint - coming soon'
  });
});

export default router;
