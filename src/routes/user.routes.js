import express from 'express';
import {
  getAllUsers,
  getUser,
  updateMe,
  deleteMe,
  createUser,
  updateUser,
  deleteUser
} from '../controllers/user.controller.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validateUpdateProfile, validateObjectId } from '../middleware/validation.js';

const router = express.Router();

// Protect all routes after this middleware
router.use(protect);

// User routes
router.get('/me', getUser);
router.patch('/update-me', validateUpdateProfile, updateMe);
router.delete('/delete-me', deleteMe);

// Admin / superadmin only routes
router.use(restrictTo('admin', 'superadmin'));

router.route('/')
  .get(getAllUsers)
  .post(createUser);

router.route('/:id')
  .get(validateObjectId(), getUser)
  .patch(validateObjectId(), updateUser)
  .delete(validateObjectId(), deleteUser);

export default router;
