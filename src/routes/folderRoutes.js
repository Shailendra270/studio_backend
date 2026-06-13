import express from 'express';
import {
  createFolder,
  updateFolder,
  getFolders,
  getFolderById,
  getFoldersByClipId,
  generateHighlight,
  highlightWebhook,
  getHighlightProgress,
  getHighlightProgressByJobId,
  createAIHighlightProxy,
  getAIHighlightProgressProxy,
  resetHighlightStatus,
  deleteFolder
} from '../controllers/folderController.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';

const router = express.Router();

router.use(protect);

// Highlights / Folders module
router.post('/', requirePermission('Highlights', 'create'), createFolder);
router.get('/', requirePermission('Highlights', 'view'), getFolders);
router.post('/get-all-folders', requirePermission('Highlights', 'view'), getFolders);
router.get('/by-clip/:clipId', requirePermission('Highlights', 'view'), getFoldersByClipId);
router.get('/highlight-progress-by-job', requirePermission('Highlights', 'view'), getHighlightProgressByJobId);
router.post('/ai-highlight', requirePermission('Highlights', 'create'), createAIHighlightProxy);
router.get('/ai-highlight-progress', requirePermission('Highlights', 'view'), getAIHighlightProgressProxy);
router.post('/generate-highlight', requirePermission('Highlights', 'create'), generateHighlight);
router.put('/:id', requirePermission('Highlights', 'edit'), updateFolder);
router.get('/:id', requirePermission('Highlights', 'view'), getFolderById);
router.post('/highlight-webhook', highlightWebhook); // webhook called by external service
router.get('/highlight-progress/:folderId', requirePermission('Highlights', 'view'), getHighlightProgress);
router.post('/reset-highlight-status/:folderId', requirePermission('Highlights', 'edit'), resetHighlightStatus);
router.delete('/:id', requirePermission('Highlights', 'delete'), deleteFolder);

export default router;
