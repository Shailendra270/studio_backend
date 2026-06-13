import express from 'express';
import { generatePresignedUrl } from '../controllers/storageController.js';
import { validateUrl } from '../controllers/validationController.js';
import { getDuration } from '../controllers/durationController.js';
import {
  createBumper,
  createOverlay,
  createGraphic,
  getBumpersAndOverlays,
  getGraphics,
  deleteBumperOrOverlay,
  deleteGraphic
} from '../controllers/assetsController.js';
import { protect as auth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';

const router = express.Router();

router.post('/presigned-url', auth, requirePermission('Assets', 'create'), generatePresignedUrl);
router.post('/validate-url', auth, requirePermission('Assets', 'view'), validateUrl);
router.post('/duration', auth, requirePermission('Assets', 'view'), getDuration);

router.post('/bumpers', auth, requirePermission('Assets', 'create'), createBumper);
router.post('/overlays', auth, requirePermission('Assets', 'create'), createOverlay);
router.post('/graphics', auth, requirePermission('Assets', 'create'), createGraphic);

router.post('/bumpers/list', auth, requirePermission('Assets', 'view'), getBumpersAndOverlays);
router.post('/overlays/list', auth, requirePermission('Assets', 'view'), getBumpersAndOverlays);
router.post('/graphics/list', auth, requirePermission('Assets', 'view'), getGraphics);

router.delete('/bumpers/:id', auth, requirePermission('Assets', 'delete'), deleteBumperOrOverlay);
router.delete('/overlays/:id', auth, requirePermission('Assets', 'delete'), deleteBumperOrOverlay);
router.delete('/graphics/:id', auth, requirePermission('Assets', 'delete'), deleteGraphic);

export default router;