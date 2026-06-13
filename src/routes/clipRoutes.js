import express from 'express';
import {
  generateClip,
  handleWebhook,
  getClips,
  getClipById,
  updateClipWithAIResponse,
  getClipProgress,
  updateClip,
  deleteClip,
  autoflip
} from '../controllers/clipController.js';
import {
  generateClipHighlight,
  clipHighlightWebhook,
  getClipHighlightProgressByJobId,
  resetClipHighlightStatus,
  overwriteClipById,
  saveClipAsNew,
  generateInputRatioClip,
  zantagDynamicCropper,
  saveClipFromFolder,
  aiSceneWebhook,
  deleteEditedClip,
  aiAutoflipWebhook,
} from '../controllers/clipController.js';
import {
  getClips as getClipsWithFilters,
  getClipById as getClipByIdDetailed,
  getClipsStats,
  getClipFilterCounts,
  getUserClips,
  getPublishedCalendar,
  getPublishedClipsByDate
} from '../controllers/clipsController.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';
import { exportClipJson } from '../controllers/clipController.js';

const router = express.Router();

// Public routes (no auth required)
router.post('/generate', generateClip);
router.post('/highlight/generate', generateClipHighlight);
router.post('/webhook/:clipId', handleWebhook);
router.post('/highlight-webhook', clipHighlightWebhook);
router.post('/ai/webhook/scenes', aiSceneWebhook);
router.post('/ai/webhook/autoflip', aiAutoflipWebhook);
router.get('/progress', getClipProgress);
router.get('/highlight-progress-by-job', getClipHighlightProgressByJobId);

router.use(protect);

// Clips module — view
router.get('/', requirePermission('Clips', 'view'), getClipsWithFilters);
router.get('/published/calendar', requirePermission('Published', 'view'), getPublishedCalendar);
router.get('/published', requirePermission('Published', 'view'), getPublishedClipsByDate);
router.get('/user/:userId', requirePermission('Clips', 'view'), getUserClips);
router.get('/stream/:streamId', requirePermission('Clips', 'view'), getClips);
router.get('/stats', requirePermission('Clips', 'view'), getClipsStats);
router.get('/filters/counts', requirePermission('Clips', 'view'), getClipFilterCounts);
router.get('/:clipId', requirePermission('Clips', 'view'), getClipByIdDetailed);
router.get('/export-json/:clipId', requirePermission('Clips', 'view'), exportClipJson);

// Clips — create / edit / delete
router.post('/:clipId/autoflip', requirePermission('Clips', 'create'), autoflip);
router.put('/:clipId', requirePermission('Clips', 'edit'), updateClip);
router.post('/highlight-reset-status/:clipId', requirePermission('Clips', 'edit'), resetClipHighlightStatus);
router.post('/overwrite/:clipId', requirePermission('Clips', 'edit'), overwriteClipById);
router.post('/save-as-new', requirePermission('Clips', 'create'), saveClipAsNew);
router.post('/save-from-folder', requirePermission('Clips', 'create'), saveClipFromFolder);
router.post('/generate/input-ratio', requirePermission('Clips', 'create'), generateInputRatioClip);
router.post('/cropper/dynamic', requirePermission('Clips', 'create'), zantagDynamicCropper);
router.post('/delete-edited', requirePermission('Clips', 'delete'), deleteEditedClip);
router.delete('/:clipId', requirePermission('Clips', 'delete'), deleteClip);
router.put('/update/:clipId', requirePermission('Clips', 'edit'), updateClipWithAIResponse);

export default router;
