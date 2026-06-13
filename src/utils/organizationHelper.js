/**
 * Helper to resolve the organization context for the current request.
 * Use when creating or listing org-scoped resources (streams, clips, folders, etc.).
 */
import OrganizationMember from '../models/OrganizationMember.js';
import User from '../models/User.js';

/**
 * Returns the organization id for the current user.
 * - If the request is org-scoped (e.g. under /api/organizations/:orgId/...), returns req.organizationId when set.
 * - Otherwise returns the user's first (default) org from OrganizationMember.
 * @param {import('express').Request} req - Must have req.user (after protect middleware).
 * @returns {Promise<import('mongoose').Types.ObjectId | null>} Organization id or null if user has no org.
 */
export async function getCurrentUserOrgId(req) {
  if (req.organizationId) {
    return req.organizationId;
  }
  /*
  // Superadmin has no organization
  if (req.user?.role === 'superadmin') {
    return null;
  }
  if (!req.user?._id) {
    return null;
  }
  const member = await OrganizationMember.findOne({
    user: req.user._id,
    status: 'Active',
  })
    .select('organization')
    .sort({ joinedAt: 1 })
    .lean();
  return member?.organization ?? null;
  */
  return null;
}

/**
 * Returns an array of userId (string) for all Active members in the current user's organization.
 * Use when listing resources that are stored by userId but should be visible to the whole org (e.g. assets).
 * - Superadmin or no org: returns null (caller should use single-user scope).
 * @param {import('express').Request} req - Must have req.user (after protect middleware).
 * @returns {Promise<string[] | null>} Array of userId strings or null.
 */
export async function getOrgMemberUserIds(req) {
  /*
  const orgId = await getCurrentUserOrgId(req);
  if (!orgId) {
    return null;
  }
  const members = await OrganizationMember.find({
    organization: orgId,
    status: 'Active',
  })
    .select('user')
    .lean();
  const userIds = members.map((m) => m.user).filter(Boolean);
  if (userIds.length === 0) {
    return null;
  }
  const users = await User.find({ _id: { $in: userIds } }).select('userId').lean();
  return users.map((u) => u.userId).filter(Boolean);
  */
  return null;
}

/**
 * Returns the organization id for a given userId (string, e.g. shortid).
 * Use when creating clips/highlights from a webhook or background job where req.user is not available.
 * @param {string} userId - User's userId string (e.g. from Clip.userId or Stream.userId).
 * @returns {Promise<import('mongoose').Types.ObjectId | null>} Organization id or null.
 */
export async function getOrgIdByUserId(userId) {
  /*
  if (!userId || typeof userId !== 'string') return null;
  const user = await User.findOne({ userId: userId.trim() }).select('_id').lean();
  if (!user?._id) return null;
  const member = await OrganizationMember.findOne({
    user: user._id,
    status: 'Active',
  })
    .select('organization')
    .sort({ joinedAt: 1 })
    .lean();
  return member?.organization ?? null;
  */
  return null;
}
