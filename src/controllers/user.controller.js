import User from '../models/User.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { activeFilter } from '../utils/softDelete.js';
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

// Filter object to remove unwanted fields
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach(el => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const sort = req.query.sort || '-createdAt';

  const users = await User.find({ active: true, ...activeFilter(req) })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .select('-password');

  const total = await User.countDocuments({ active: true, ...activeFilter(req) });

  res.status(200).json({
    status: true,
    results: users.length,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    },
    data: {
      users,
    },
  });
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private
export const getUser = asyncHandler(async (req, res, next) => {
  const userId = req.params.id || req.user._id;
  
  const user = await User.findOne({ _id: userId, ...activeFilter(req) });
  
  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: true,
    message: 'User fetched successfully',
    data: {
      user,
    },
  });
});

// @desc    Update current user
// @route   PATCH /api/users/update-me
// @access  Private
export const updateMe = asyncHandler(async (req, res, next) => {
  // Create error if user POSTs password data
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /api/auth/update-password.',
        400
      )
    );
  }

  // Filter out unwanted fields names that are not allowed to be updated
  const filteredBody = filterObj(req.body, 'name', 'email', 'bio', 'preferences');

  // Update user document
  const updatedUser = await User.findByIdAndUpdate(req.user.id, { ...filteredBody, ...getAuditStamp(req) }, {
    new: true,
    runValidators: true,
  });
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'update',
    entity: 'user',
    entityId: updatedUser?._id?.toString?.(),
    metadata: { fields: Object.keys(filteredBody || {}) },
  });

  logger.info(`User profile updated: ${updatedUser.email}`);

  res.status(200).json({
    status: true,
    message: 'User profile updated successfully',
    data: {
      user: updatedUser,
    },
  });
});

// @desc    Delete current user (deactivate)
// @route   DELETE /api/users/delete-me
// @access  Private
export const deleteMe = asyncHandler(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { active: false, ...getSoftDeleteStamp(req) },
    { new: true }
  );
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'delete',
    entity: 'user',
    entityId: user?._id?.toString?.(),
  });

  logger.info(`User account deactivated: ${req.user.email}`);

  res.status(204).json({
    status: true,
    message: 'User account deactivated successfully',
    data: null,
  });
});

// @desc    Create user (Admin only)
// @route   POST /api/users
// @access  Private/Admin
export const createUser = asyncHandler(async (req, res, next) => {
  const newUser = await User.create(req.body);

  logger.info(`New user created by admin: ${newUser.email}`);

  res.status(201).json({
    status: true,
    message: 'User signed up successfully',
    data: {
      user: newUser,
    },
  });
});

// @desc    Update user (Admin only)
// @route   PATCH /api/users/:id
// @access  Private/Admin
export const updateUser = asyncHandler(async (req, res, next) => {
  const user = await User.findOneAndUpdate({ _id: req.params.id, ...activeFilter(req) }, { ...req.body, ...getAuditStamp(req) }, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  logger.info(`User updated by admin: ${user.email}`);

  res.status(200).json({
    status: true,
    message: 'User updated successfully',
    data: {
      user,
    },
  });
});

// @desc    Delete user (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, ...activeFilter(req) },
    { active: false, ...getSoftDeleteStamp(req) },
    { new: true }
  );

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  logger.info(`User deleted by admin: ${user.email}`);
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'delete',
    entity: 'user',
    entityId: user?._id?.toString?.(),
  });

  res.status(204).json({
    status: true,
    message: 'User deleted successfully',
    data: null,
  });
});
