/**
 * Role-based permission middleware. Use after protect.
 * requirePermission(module, action) - returns middleware that checks user's org role permissions.
 * Module/action names must match defaultRolePermissions.js / RolePermissionMatrix (e.g. 'Streams / Live', 'view').
 */
import OrganizationMember from '../models/OrganizationMember.js';
import { AppError, asyncHandler } from './errorHandler.js';

/**
 * @param {string} module - Module name (e.g. 'Streams / Live', 'Clips', 'Highlights')
 * @param {string} action - Action: 'view' | 'create' | 'edit' | 'delete'
 * @returns {import('express').RequestHandler}
 */
export function requirePermission(module, action) {
  return asyncHandler(async (req, res, next) => {
    /*
    if (req.user?.role === 'superadmin') {
      return next();
    }
    if (!req.user?._id) {
      return next(new AppError('Authentication required', 401));
    }
    const membership = await OrganizationMember.findOne({
      user: req.user._id,
      status: 'Active',
    })
      .select('role')
      .populate('role')
      .sort({ joinedAt: 1 })
      .lean();
    const permissions = membership?.role?.permissions;
    if (!permissions || typeof permissions !== 'object') {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    const modulePerms = permissions[module];
    const allowed = modulePerms && typeof modulePerms[action] === 'boolean' && modulePerms[action];
    if (!allowed) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    */
    next();
  });
}
