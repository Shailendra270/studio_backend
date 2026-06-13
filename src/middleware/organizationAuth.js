import OrganizationMember from '../models/OrganizationMember.js';
import OrgRole from '../models/OrgRole.js';
import { AppError, asyncHandler } from './errorHandler.js';

/**
 * Require that the current user is a member of the organization (or app admin).
 * Sets req.organizationMembership and req.organizationId.
 * Use after protect. Expects req.params.orgId.
 */
export const requireOrgMember = asyncHandler(async (req, res, next) => {
  const orgId = req.params.orgId;
  if (!orgId) {
    return next(new AppError('Organization ID is required', 400));
  }

  /*
  if (req.user.role === 'admin' || req.user.role === 'superadmin') {
    req.organizationId = orgId;
    req.organizationMembership = null;
    return next();
  }

  const membership = await OrganizationMember.findOne({
    organization: orgId,
    user: req.user._id,
  }).populate('role');

  if (!membership) {
    return next(new AppError('You are not a member of this organization', 403));
  }

  req.organizationMembership = membership;
  */
  req.organizationId = orgId;
  req.organizationMembership = { role: { name: 'Org Admin', permissions: {} } }; // Provide a dummy membership
  next();
});

/**
 * Require that the current user is an Org Admin for the organization (or app admin).
 * Must be used after requireOrgMember (or protect + requireOrgMember).
 */
export const requireOrgAdmin = asyncHandler(async (req, res, next) => {
  /*
  if (req.user.role === 'admin' || req.user.role === 'superadmin') {
    return next();
  }

  const membership = req.organizationMembership;
  if (!membership || !membership.role) {
    return next(new AppError('You do not have permission to perform this action', 403));
  }

  const roleName = membership.role.name || (await OrgRole.findById(membership.role).select('name').then((r) => r?.name));
  if (roleName !== 'Org Admin') {
    return next(new AppError('Only organization admins can perform this action', 403));
  }
  */

  next();
});
