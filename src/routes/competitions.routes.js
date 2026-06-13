import express from 'express';
import { createCompetition, updateCompetition, deleteCompetition, getCompetitions, syncCompetitionFromDSG } from '../controllers/competitionsController.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';

const router = express.Router();

router.post('/create', protect, requirePermission('Competitions', 'create'), createCompetition);
router.put('/update', protect, requirePermission('Competitions', 'edit'), updateCompetition);
router.delete('/delete', protect, requirePermission('Competitions', 'delete'), deleteCompetition);
router.post('/list', protect, requirePermission('Competitions', 'view'), getCompetitions);
router.get('/sync/:seasonId', protect, requirePermission('Competitions', 'edit'), syncCompetitionFromDSG);

export default router;
