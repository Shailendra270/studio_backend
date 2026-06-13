import express from 'express';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';
import {
  getMediaLibraryList,
  getMediaLibraryStats,
  getMediaLibraryFilterCounts,
  backfillMatchMetadata,
} from '../controllers/mediaLibraryController.js';

const router = express.Router();

router.use(protect);
router.get('/', requirePermission('Clips', 'view'), getMediaLibraryList);
router.get('/stats', requirePermission('Clips', 'view'), getMediaLibraryStats);
router.get('/filters/counts', requirePermission('Clips', 'view'), getMediaLibraryFilterCounts);
router.post('/backfill-match-metadata', requirePermission('Clips', 'view'), backfillMatchMetadata);

export default router;
