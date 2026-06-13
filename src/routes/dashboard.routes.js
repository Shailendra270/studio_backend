import express from 'express';
import { protect } from '../middleware/auth.js';
import { getDashboardSettings, updateDashboardSettings, getDashboardFeed } from '../controllers/dashboardController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Single dashboard feed: streams + clips + highlights in one call (no separate stream/media-library APIs needed)
router.get('/feed', getDashboardFeed);

// Org-scoped dashboard settings (visible filters, etc.)
router.get('/settings', getDashboardSettings);
router.patch('/settings', updateDashboardSettings);

// Basic dashboard routes (to be expanded)
router.get('/stats', (req, res) => {
  res.json({
    status: 'success',
    message: 'Dashboard stats - coming soon',
    data: {
      totalVideos: 0,
      totalViews: 0,
      totalLikes: 0,
      storageUsed: 0
    }
  });
});

export default router;
