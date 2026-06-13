import express from 'express';
import {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  refreshToken,
  getMe,
  updatePassword
} from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';
import {
  validateSignup,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword
} from '../middleware/validation.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', validateLogin, login);
router.post('/logout', logout);
router.post('/forgot-password', validateForgotPassword, forgotPassword);
router.patch('/reset-password/:token', validateResetPassword, resetPassword);
router.get('/verify-email/:token', verifyEmail);
router.post('/refresh-token', refreshToken);

// Protected routes
router.use(protect); // All routes after this middleware are protected

router.get('/me', getMe);
router.patch('/update-password', validateChangePassword, updatePassword);

// Teams endpoints — Teams module
import { createTeam as createTeamHandler, updateTeam as updateTeamHandler, deleteTeam as deleteTeamHandler, getTeams as getTeamsHandler, getAllEditTeams as getAllEditTeamsHandler } from '../controllers/teamsController.js';

router.post('/team/create', requirePermission('Teams', 'create'), createTeamHandler);
router.post('/team/update', requirePermission('Teams', 'edit'), updateTeamHandler);
router.post('/team/delete', requirePermission('Teams', 'delete'), deleteTeamHandler);
router.post('/teams', requirePermission('Teams', 'view'), getTeamsHandler);
router.post('/teams/all', requirePermission('Teams', 'view'), getAllEditTeamsHandler);

// Competitions endpoints — Competitions module
import { createCompetition as createCompetitionHandler, updateCompetition as updateCompetitionHandler, deleteCompetition as deleteCompetitionHandler, getCompetitions as getCompetitionsHandler } from '../controllers/competitionsController.js';

router.post('/competition/create', requirePermission('Competitions', 'create'), createCompetitionHandler);
router.post('/competition/update', requirePermission('Competitions', 'edit'), updateCompetitionHandler);
router.post('/competition/delete', requirePermission('Competitions', 'delete'), deleteCompetitionHandler);
router.post('/competitions', requirePermission('Competitions', 'view'), getCompetitionsHandler);

export default router;
