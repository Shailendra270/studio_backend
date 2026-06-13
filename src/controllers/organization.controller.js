import path from 'path';
import mongoose from 'mongoose';
import { Storage } from '@google-cloud/storage';
import Organization from '../models/Organization.js';
import OrgRole from '../models/OrgRole.js';
import OrganizationMember from '../models/OrganizationMember.js';
import User from '../models/User.js';
import Stream from '../models/Stream.js';
import Folder from '../models/Folder.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { PRESET_PERMISSIONS, DEFAULT_ROLE_NAMES } from '../constants/defaultRolePermissions.js';
import logger from '../utils/logger.js';
// import { sendMail } from '../services/emailService.js';
// import { getOrgInviteEmailHtml, getOrgInviteEmailText } from '../templates/emailTemplates.js';
import { computeSoftDeleteRemainingDays } from '../utils/softDeleteGrace.js';
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

const gcpStorage = new Storage({
  keyFilename: path.join(process.cwd(), process.env.GCP_KEY_FILE || 'env_config/gcp-service-account.json'),
  projectId: process.env.GCP_PROJECT_ID || 'zeta-envoy-462108-b8',
});
const GCP_BUCKET_NAME = process.env.GCP_BUCKET_NAME || 'gcp-mulistream-dev';
const GCP_STORAGE_ENDPOINT = 'https://storage.googleapis.com';
const ORG_LOGOS_FOLDER = 'organizations/';

// ---------- Helpers ----------

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

/** Create default roles for an organization */
export const seedDefaultRoles = async (organizationId) => {
  const roles = [];
  for (const name of DEFAULT_ROLE_NAMES) {
    const role = await OrgRole.create({
      organization: organizationId,
      name,
      isSystem: true,
      permissions: PRESET_PERMISSIONS[name] || {},
    });
    roles.push(role);
  }
  return roles;
};

/** Get members count for an org */
const getMembersCount = async (orgId) => {
  // return OrganizationMember.countDocuments({ organization: orgId, isDeleted: { $ne: true } });
  return 0;
};

/** Get streams count for an org (streams with organization = orgId) */
const getStreamsCount = async (orgId) => {
  return Stream.countDocuments({ organization: orgId });
};

/** Get highlights (folders) count for an org */
const getHighlightsCount = async (orgId) => {
  return Folder.countDocuments({ organization: orgId });
};

/** Get published highlights count (folders with at least one publish) */
const getPublishedCount = async (orgId) => {
  return Folder.countDocuments({
    organization: orgId,
    $or: [{ highlightPublishCount: { $gt: 0 } }, { 'clipPublished.0': { $exists: true } }],
  });
};

/** Get activity for last N days: streams + highlights created per day for org */
const getActivityByDay = async (orgId, days = 15) => {
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setUTCHours(0, 0, 0, 0);
  const streamDays = await Stream.aggregate([
    { $match: { organization: orgId, createdAt: { $gte: start } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
  ]);
  const folderDays = await Folder.aggregate([
    { $match: { organization: orgId, createdAt: { $gte: start } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
  ]);
  const byDate = {};
  for (let d = 0; d < days; d++) {
    const dte = new Date();
    dte.setDate(dte.getDate() - (days - 1 - d));
    dte.setUTCHours(0, 0, 0, 0);
    const key = dte.toISOString().slice(0, 10);
    byDate[key] = { date: key, count: 0, label: formatActivityLabel(key) };
  }
  streamDays.forEach((r) => {
    if (byDate[r._id]) byDate[r._id].count += r.count;
  });
  folderDays.forEach((r) => {
    if (byDate[r._id]) byDate[r._id].count += r.count;
  });
  return Object.keys(byDate)
    .sort()
    .map((k) => byDate[k]);
};

function formatActivityLabel(isoDate) {
  const d = new Date(isoDate + 'T12:00:00Z');
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  return `${mon} ${day}`;
}

// Normalize permissions so they always obey core invariants:
// - If view is false for a module, all other actions are forced to false.
// - If any of create/edit/delete is true, view is forced to true.
const normalizePermissions = (permissions = {}) => {
  const normalized = {};
  Object.keys(permissions || {}).forEach((mod) => {
    const raw = permissions[mod] || {};
    const base = {
      view: !!raw.view,
      create: !!raw.create,
      edit: !!raw.edit,
      delete: !!raw.delete,
    };

    // If any non-view action is enabled, ensure view is also enabled
    if (base.create || base.edit || base.delete) {
      base.view = true;
    }

    // If view is false, nothing else should be allowed
    if (!base.view) {
      base.create = false;
      base.edit = false;
      base.delete = false;
    }

    normalized[mod] = base;
  });
  return normalized;
};

// ---------- Organizations CRUD ----------

/** GET /api/organizations - List orgs for current user or all if admin */
export const listOrganizations = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip = (page - 1) * limit;

  const statusFilter = req.query.statusFilter;

  let query;
  if (statusFilter === 'softDeleted') {
    query = { isDeleted: true };
  } else {
    // default: active or suspended but not soft-deleted
    query = { isDeleted: { $ne: true } };
  }
  /*
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    const memberOrgIds = await OrganizationMember.distinct('organization', { user: req.user._id });
    query = { ...query, _id: { $in: memberOrgIds } };
  }
  */

  const [orgs, total] = await Promise.all([
    Organization.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Organization.countDocuments(query),
  ]);

  const orgIds = orgs.map((o) => o._id);
  const [memberCounts, streamCounts, highlightCounts] = await Promise.all([
    // OrganizationMember.aggregate([{ $match: { organization: { $in: orgIds } } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
    Promise.resolve([]),
    Stream.aggregate([{ $match: { organization: { $in: orgIds } } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
    Folder.aggregate([{ $match: { organization: { $in: orgIds } } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
  ]);
  const memberMap = Object.fromEntries(memberCounts.map((c) => [c._id.toString(), c.count]));
  const streamMap = Object.fromEntries(streamCounts.map((c) => [c._id.toString(), c.count]));
  const highlightMap = Object.fromEntries(highlightCounts.map((c) => [c._id.toString(), c.count]));

  const data = orgs.map((org) => ({
    ...org,
    usersCount: memberMap[org._id.toString()] ?? 0,
    streamsCount: streamMap[org._id.toString()] ?? 0,
    highlightsCount: highlightMap[org._id.toString()] ?? 0,
    // Soft-delete metadata for UI
    deletedAt: org.deletedAt || null,
  }));

  res.status(200).json({
    status: true,
    results: data.length,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    data: { organizations: data },
  });
});

/** POST /api/organizations - Create organization */
export const createOrganization = asyncHandler(async (req, res) => {
  const body = filterObj(req.body, 'name', 'contactEmail', 'contactPhone', 'status');
  if (body.contactEmail) {
    body.contactEmail = body.contactEmail.toLowerCase();
  }

  // Enforce global uniqueness of email across users and organizations, with soft-delete grace period
  if (body.contactEmail) {
    const [existingUserAll, existingOrgAll] = await Promise.all([
      User.findOne({ email: body.contactEmail }),
      Organization.findOne({ contactEmail: body.contactEmail }),
    ]);

    // 1) If there is a soft-deleted organization with this email, prefer that message
    if (existingOrgAll && existingOrgAll.isDeleted === true) {
      const deletedRef =
        existingOrgAll.deletedAt || existingOrgAll.updatedAt || existingOrgAll.createdAt;
      if (deletedRef) {
        const now = new Date();
        const deletedDate = new Date(deletedRef);
        const daysAgo = Math.max(
          0,
          Math.floor((now.getTime() - deletedDate.getTime()) / (24 * 60 * 60 * 1000))
        );
        const daysAgoPlural = daysAgo === 1 ? 'day' : 'days';

        throw new AppError(
          `This organization with this email was deleted ${daysAgo} ${daysAgoPlural} ago and can be restored from the Soft Deleted section instead of creating a new one.`,
          400
        );
      }
    }

    // 2) Otherwise enforce usual uniqueness + grace-period rules
    const activeUser = existingUserAll && existingUserAll.isDeleted !== true;
    const activeOrg = existingOrgAll && existingOrgAll.isDeleted !== true;

    if (activeUser || activeOrg) {
      throw new AppError(
        'This email is already in use in the system. Please use a new E-mail.',
        400
      );
    }

    const candidate = existingUserAll || existingOrgAll;
    if (candidate && candidate.isDeleted === true) {
      // For older records that don't have deletedAt yet, fall back to updatedAt/createdAt
      const deletedRef = candidate.deletedAt || candidate.updatedAt || candidate.createdAt;
      if (deletedRef) {
        const { withinGrace, remainingDays } = computeSoftDeleteRemainingDays(deletedRef);
        if (withinGrace) {
          const plural = remainingDays === 1 ? 'day' : 'days';
          throw new AppError(
            `This account with this email was recently deleted. Please wait ${remainingDays} more ${plural} or use a new email.`,
            400
          );
        }
      }
    }
  }

  const org = await Organization.create(body);
  await seedDefaultRoles(org._id);

  if (req.body.createAdminAccount && req.body.password && req.body.email) {
    const email = req.body.email.toLowerCase();
    let adminUser = await User.findOne({ email, isDeleted: { $ne: true } });

    // Create a brand new user when no existing account matches the email
    if (!adminUser) {
      adminUser = await User.create({
        name: req.body.name || email.split('@')[0],
        email,
        password: req.body.password,
      });
    }

    const orgAdminRole = await OrgRole.findOne({ organization: org._id, name: 'Org Admin' });
    /*
    if (orgAdminRole) {
      // Create org membership if it doesn't already exist
      const existingMember = await OrganizationMember.findOne({
        organization: org._id,
        user: adminUser._id,
      });
      if (!existingMember) {
        await OrganizationMember.create({
          organization: org._id,
          user: adminUser._id,
          role: orgAdminRole._id,
          status: 'Active',
        });
      }
    }
    */
  }

  const [usersCount, streamsCount, highlightsCount] = await Promise.all([
    getMembersCount(org._id),
    getStreamsCount(org._id),
    getHighlightsCount(org._id),
  ]);
  res.status(201).json({
    status: true,
    message: 'Organization created successfully',
    data: {
      organization: {
        ...org.toObject(),
        usersCount,
        streamsCount,
        highlightsCount,
      },
    },
  });
});

/** GET /api/organizations/:orgId - Get one org with counts */
export const getOrganization = asyncHandler(async (req, res, next) => {
  const org = await Organization.findOne({ _id: req.params.orgId, isDeleted: { $ne: true } });
  if (!org) return next(new AppError('Organization not found', 404));

  const [usersCount, streamsCount, highlightsCount] = await Promise.all([
    getMembersCount(org._id),
    getStreamsCount(org._id),
    getHighlightsCount(org._id),
  ]);
  res.status(200).json({
    status: true,
    data: {
      organization: {
        ...org.toObject(),
        usersCount,
        streamsCount,
        highlightsCount,
      },
    },
  });
});

/** GET /api/organizations/:orgId/overview - Stats + activity for overview dashboard (dynamic) */
export const getOrganizationOverview = asyncHandler(async (req, res, next) => {
  const org = await Organization.findOne({ _id: req.params.orgId, isDeleted: { $ne: true } });
  if (!org) return next(new AppError('Organization not found', 404));

  const [usersCount, streamsCount, highlightsCount, publishedCount, activity] = await Promise.all([
    getMembersCount(org._id),
    getStreamsCount(org._id),
    getHighlightsCount(org._id),
    getPublishedCount(org._id),
    getActivityByDay(org._id, 15),
  ]);
  const publishRate = highlightsCount > 0 ? Math.round((publishedCount / highlightsCount) * 100) : 0;
  res.status(200).json({
    status: true,
    data: {
      overview: {
        usersCount,
        streamsCount,
        highlightsCount,
        publishedCount,
        publishRate,
        activity,
      },
    },
  });
});

/** PATCH /api/organizations/:orgId - Update org */
export const updateOrganization = asyncHandler(async (req, res, next) => {
  const body = filterObj(req.body, 'name', 'contactEmail', 'contactPhone', 'status', 'logoUrl');
  Object.assign(body, getAuditStamp(req));
  const org = await Organization.findOneAndUpdate(
    { _id: req.params.orgId, isDeleted: { $ne: true } },
    body,
    {
    new: true,
    runValidators: true,
  });
  if (!org) return next(new AppError('Organization not found', 404));

  const [usersCount, streamsCount, highlightsCount] = await Promise.all([
    getMembersCount(org._id),
    getStreamsCount(org._id),
    getHighlightsCount(org._id),
  ]);
  res.status(200).json({
    status: true,
    message: 'Organization updated successfully',
    data: {
      organization: {
        ...org.toObject(),
        usersCount,
        streamsCount,
        highlightsCount,
      },
    },
  });
});

/** DELETE /api/organizations/:orgId - Delete org and memberships */
export const deleteOrganization = asyncHandler(async (req, res, next) => {
  const org = await Organization.findOne({ _id: req.params.orgId, isDeleted: { $ne: true } });
  if (!org) return next(new AppError('Organization not found', 404));

  // Soft delete: mark org as deleted and suspend it;
  // keep associated roles/members for historical data.
  Object.assign(org, getSoftDeleteStamp(req));
  org.status = 'Suspended';
  await org.save();
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'delete',
    entity: 'organization',
    entityId: org._id?.toString?.(),
    orgId: org._id,
  });

  res.status(204).json({ status: true, message: 'Organization deleted', data: null });
});

/** PATCH /api/organizations/:orgId/restore - Restore a soft-deleted org */
export const restoreOrganization = asyncHandler(async (req, res, next) => {
  const org = await Organization.findOne({ _id: req.params.orgId, isDeleted: true });
  if (!org) return next(new AppError('Organization not found or not deleted', 404));

  org.isDeleted = false;
  org.deletedAt = null;
  org.deletedBy = '';
  org.deletedIp = '';
  org.deletedCountry = 'UNKNOWN';
  Object.assign(org, getAuditStamp(req));
  if (org.status === 'Suspended') {
    org.status = 'Active';
  }
  await org.save();

  const [usersCount, streamsCount, highlightsCount] = await Promise.all([
    getMembersCount(org._id),
    getStreamsCount(org._id),
    getHighlightsCount(org._id),
  ]);

  res.status(200).json({
    status: true,
    message: 'Organization restored successfully',
    data: {
      organization: {
        ...org.toObject(),
        usersCount,
        streamsCount,
        highlightsCount,
      },
    },
  });
});

/** POST /api/organizations/:orgId/logo/upload-url - Get presigned URL to upload org logo (same GCP bucket) */
export const getOrgLogoUploadUrl = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { fileName, contentType } = req.body;
  if (!fileName || !contentType) {
    return next(new AppError('fileName and contentType are required', 400));
  }
  const ext = (fileName.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const safeName = `logo_${Date.now()}.${ext}`;
  const filePath = `${ORG_LOGOS_FOLDER}${orgId}/${safeName}`;
  const bucket = gcpStorage.bucket(GCP_BUCKET_NAME);
  const file = bucket.file(filePath);
  const [presignedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 60 * 60 * 1000,
    contentType: contentType || 'image/png',
  });
  const logoUrl = `${GCP_STORAGE_ENDPOINT}/${GCP_BUCKET_NAME}/${filePath}`;
  res.status(200).json({
    status: true,
    message: 'Upload URL generated',
    data: { presignedUrl, logoUrl },
  });
});

// ---------- Members ----------

/** GET /api/organizations/:orgId/members - List members with user + role */
export const listMembers = asyncHandler(async (req, res) => {
  /*
  const statusFilter = req.query.statusFilter;

  const memberQuery = { organization: req.params.orgId };

  memberQuery.isDeleted = { $ne: true };
  const members = await OrganizationMember.find(memberQuery)
    .populate('user', 'name email avatar lastLogin active isDeleted')
    .populate('role', 'name')
    .lean();

  const rawData = members.map((m) => {
    const isSoftDeletedUser = m.user && m.user.isDeleted === true;
    const effectiveStatus = m.status === 'Active' ? 'Active' : 'Inactive';

    return {
      id: m._id,
      memberId: m._id,
      user: m.user
        ? {
            id: m.user._id,
            name: m.user.name,
            email: m.user.email,
            avatar: m.user.avatar,
            lastLogin: m.user.lastLogin,
            isDeleted: m.user.isDeleted === true,
          }
        : null,
      role: m.role ? m.role.name : null,
      roleId: m.role?._id,
      status: effectiveStatus,
      isSoftDeletedUser,
      lastLogin: m.user?.lastLogin
        ? formatLastLogin(m.user.lastLogin)
        : 'Never',
    };
  });

  let data = rawData;
  if (statusFilter === 'softDeleted') {
    data = rawData.filter((m) => m.isSoftDeletedUser);
  } else if (statusFilter === 'active') {
    data = rawData.filter((m) => !m.isSoftDeletedUser && m.status === 'Active');
  } else if (statusFilter === 'inactive') {
    data = rawData.filter((m) => !m.isSoftDeletedUser && m.status !== 'Active');
  }

  res.status(200).json({
    status: true,
    results: data.length,
    data: { members: data },
  });
  */
  res.status(200).json({
    status: true,
    results: 0,
    data: { members: [] },
  });
});

function formatLastLogin(date) {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60) return diffMins <= 1 ? 'Just now' : `${diffMins} minutes ago`;
  if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  if (diffDays < 7) return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  return d.toLocaleDateString();
}

/** POST /api/organizations/:orgId/members - Add/invite user */
export const addMember = asyncHandler(async (req, res, next) => {
  /*
  const { fullName, email, roleId, sendInvite, password, confirmPassword } = req.body;
  if (!fullName || !email) return next(new AppError('Full name and email are required', 400));
  if (!roleId) return next(new AppError('Role is required', 400));

  let user = await User.findOne({ email: email.toLowerCase().trim(), isDeleted: { $ne: true } });
  let wasNewUser = false;
  if (!user) {
    const pwd = password && password.length >= 6 ? password : undefined;
    if (!pwd) return next(new AppError('Password is required for new users (min 6 characters)', 400));
    if (confirmPassword && pwd !== confirmPassword) return next(new AppError('Passwords do not match', 400));
    user = await User.create({
      name: fullName.trim(),
      email: email.toLowerCase().trim(),
      password: pwd,
    });
    wasNewUser = true;
  }

  const existing = await OrganizationMember.findOne({
    organization: req.params.orgId,
    user: user._id,
    isDeleted: { $ne: true },
  });
  if (existing) return next(new AppError('This email is already in use in the system. Please use a new E-mail', 400));

  const role = await OrgRole.findOne({ _id: roleId, organization: req.params.orgId, isDeleted: { $ne: true } });
  if (!role) return next(new AppError('Invalid role', 400));

  const member = await OrganizationMember.create({
    organization: req.params.orgId,
    user: user._id,
    role: role._id,
    status: 'Active',
    joinedAt: new Date(),
  });

  const populated = await OrganizationMember.findOne({ _id: member._id, isDeleted: { $ne: true } })
    .populate('user', 'name email avatar lastLogin')
    .populate('role', 'name')
    .lean();

  res.status(201).json({
    status: true,
    message: 'User added to organization',
    data: {
      member: {
        id: populated._id,
        memberId: populated._id,
        user: {
          id: populated.user._id,
          name: populated.user.name,
          email: populated.user.email,
          avatar: populated.user.avatar,
          lastLogin: populated.user.lastLogin,
        },
        role: populated.role.name,
        roleId: populated.role._id,
        status: populated.status,
      },
    },
  });
  */
  res.status(201).json({
    status: true,
    message: 'Membership logic is disabled',
  });
});

/** PATCH /api/organizations/:orgId/members/:memberId */
export const updateMember = asyncHandler(async (req, res, next) => {
  /*
  const { email, password, confirmPassword } = req.body;
  const body = filterObj(req.body, 'roleId', 'status', 'email', 'password', 'confirmPassword');
  const member = await OrganizationMember.findOne({
    _id: req.params.memberId,
    organization: req.params.orgId,
    isDeleted: { $ne: true },
  }).populate('role');
  if (!member) return next(new AppError('Member not found', 404));
  const user = await User.findById(member.user).select('+password');
  if (!user) return next(new AppError('User not found for this member', 404));

  if (body.email !== undefined) {
    const newEmail = body.email.trim().toLowerCase();
    if (!newEmail) return next(new AppError('Email is required', 400));
    if (newEmail !== user.email) {
      const existing = await User.findOne({ email: newEmail, isDeleted: { $ne: true } });
      if (existing) return next(new AppError('Another user already has this email', 400));
      user.email = newEmail;
    }
  }
  if (body.password !== undefined && body.password !== '') {
    if (body.password.length < 6) return next(new AppError('Password must be at least 6 characters', 400));
    if (body.password !== (body.confirmPassword || '')) return next(new AppError('Passwords do not match', 400));
    user.password = body.password;
  }

  // Enforce "at least one Org Admin" invariant when changing role/status
  const orgAdminRole = await OrgRole.findOne({
    organization: req.params.orgId,
    name: 'Org Admin',
    isDeleted: { $ne: true },
  });

  if (orgAdminRole) {
    const isCurrentlyOrgAdmin =
      member.role &&
      (member.role._id?.toString?.() === orgAdminRole._id.toString() ||
        member.role.toString?.() === orgAdminRole._id.toString());

    if (isCurrentlyOrgAdmin) {
      const nextRoleId = body.roleId || orgAdminRole._id.toString();
      const nextStatus = body.status || member.status;

      const willStillBeOrgAdminActive =
        nextRoleId.toString() === orgAdminRole._id.toString() && nextStatus === 'Active';

      if (!willStillBeOrgAdminActive) {
        const otherAdmins = await OrganizationMember.countDocuments({
          organization: req.params.orgId,
          role: orgAdminRole._id,
          status: 'Active',
          isDeleted: { $ne: true },
          _id: { $ne: member._id },
        });

        if (otherAdmins === 0) {
          return next(
            new AppError('At least one Org Admin must remain active in the organization.', 400)
          );
        }
      }
    }
  }

  Object.assign(user, getAuditStamp(req));
  await user.save({ validateBeforeSave: true });

  if (body.roleId) {
    const role = await OrgRole.findOne({ _id: body.roleId, organization: req.params.orgId, isDeleted: { $ne: true } });
    if (!role) return next(new AppError('Invalid role', 400));
    member.role = role._id;
  }
  if (body.status) member.status = body.status;
  Object.assign(member, getAuditStamp(req));
  await member.save();
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'update',
    entity: 'organization_member',
    entityId: member._id?.toString?.(),
    orgId: member.organization || req.params.orgId,
    metadata: { fields: Object.keys(body || {}) },
  });

  const populated = await OrganizationMember.findOne({ _id: member._id, isDeleted: { $ne: true } })
    .populate('user', 'name email avatar lastLogin')
    .populate('role', 'name')
    .lean();

  res.status(200).json({
    status: true,
    message: 'Member updated',
    data: {
      member: {
        id: populated._id,
        role: populated.role.name,
        roleId: populated.role._id,
        status: populated.status,
      },
    },
  });
  */
  res.status(200).json({
    status: true,
    message: 'Membership logic is disabled',
  });
});

/** DELETE /api/organizations/:orgId/members/:memberId */
export const removeMember = asyncHandler(async (req, res, next) => {
  /*
  const member = await OrganizationMember.findOne({
    _id: req.params.memberId,
    organization: req.params.orgId,
    isDeleted: { $ne: true },
  }).populate('role', 'name');

  if (!member) return next(new AppError('Member not found', 404));

  // Prevent deleting the last Org Admin for an organization
  const isOrgAdmin =
    member.role && typeof member.role === 'object' && member.role.name === 'Org Admin';

  if (isOrgAdmin) {
    const orgAdminRole = await OrgRole.findOne({
      organization: req.params.orgId,
      name: 'Org Admin',
      isDeleted: { $ne: true },
    });

    if (orgAdminRole) {
      const otherAdmins = await OrganizationMember.countDocuments({
        organization: req.params.orgId,
        role: orgAdminRole._id,
        status: 'Active',
        isDeleted: { $ne: true },
        _id: { $ne: member._id },
      });

      if (otherAdmins === 0) {
        return next(
          new AppError('At least one Org Admin is required for the organization.', 400)
        );
      }
    }
  }

  await OrganizationMember.updateOne(
    { _id: member._id, isDeleted: { $ne: true } },
    { $set: getSoftDeleteStamp(req) }
  );
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'delete',
    entity: 'organization_member',
    entityId: member._id?.toString?.(),
    orgId: member.organization || req.params.orgId,
  });

  res.status(204).json({ status: true, message: 'Member removed', data: null });
  */
  res.status(204).json({ status: true, message: 'Membership logic is disabled', data: null });
});

// ---------- Roles ----------

/** GET /api/organizations/:orgId/roles */
export const listRoles = asyncHandler(async (req, res) => {
  const orgId = req.params.orgId;
  const roles = await OrgRole.find({ organization: orgId, isDeleted: { $ne: true } }).lean();
  /*
  const memberCounts = await OrganizationMember.aggregate([
    {
      $match: {
        organization: new mongoose.Types.ObjectId(orgId),
        status: 'Active',
      },
    },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(memberCounts.map((c) => [c._id.toString(), c.count]));
  */
  const countMap = {};

  const data = roles.map((r) => ({
    id: r._id,
    name: r.name,
    isSystem: r.isSystem,
    permissions: r.permissions,
    usersCount: countMap[r._id.toString()] ?? 0,
  }));

  res.status(200).json({
    status: true,
    results: data.length,
    data: { roles: data },
  });
});

/** POST /api/organizations/:orgId/roles */
export const createRole = asyncHandler(async (req, res, next) => {
  const { name, permissions } = req.body;
  if (!name || !name.trim()) return next(new AppError('Role name is required', 400));

  const existing = await OrgRole.findOne({
    organization: req.params.orgId,
    name: name.trim(),
    isDeleted: { $ne: true },
  });
  if (existing) return next(new AppError('A role with this name already exists', 400));

  const role = await OrgRole.create({
    organization: req.params.orgId,
    name: name.trim(),
    isSystem: false,
    permissions: normalizePermissions(permissions || {}),
  });

  res.status(201).json({
    status: true,
    message: 'Role created',
    data: { role: { id: role._id, name: role.name, isSystem: role.isSystem, permissions: role.permissions, usersCount: 0 } },
  });
});

/** PATCH /api/organizations/:orgId/roles/:roleId */
export const updateRole = asyncHandler(async (req, res, next) => {
  const role = await OrgRole.findOne({
    _id: req.params.roleId,
    organization: req.params.orgId,
    isDeleted: { $ne: true },
  });
  if (!role) return next(new AppError('Role not found', 404));
  if (role.isSystem && req.body.name && req.body.name.trim() !== role.name) {
    return next(new AppError('System role name cannot be changed', 400));
  }

  const body = filterObj(req.body, 'name', 'permissions');
  if (body.name) role.name = body.name.trim();
  if (body.permissions && typeof body.permissions === 'object') {
    role.permissions = normalizePermissions(body.permissions);
  }
  Object.assign(role, getAuditStamp(req));
  await role.save();
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'update',
    entity: 'organization_role',
    entityId: role._id?.toString?.(),
    orgId: req.params.orgId,
    metadata: { fields: Object.keys(body || {}) },
  });

  // const usersCount = await OrganizationMember.countDocuments({ role: role._id, isDeleted: { $ne: true } });
  const usersCount = 0;
  res.status(200).json({
    status: true,
    message: 'Role updated',
    data: {
      role: {
        id: role._id,
        name: role.name,
        isSystem: role.isSystem,
        permissions: role.permissions,
        usersCount,
      },
    },
  });
});

/** DELETE /api/organizations/:orgId/roles/:roleId */
export const deleteRole = asyncHandler(async (req, res, next) => {
  const role = await OrgRole.findOne({
    _id: req.params.roleId,
    organization: req.params.orgId,
    isDeleted: { $ne: true },
  });
  if (!role) return next(new AppError('Role not found', 404));
  if (role.isSystem) return next(new AppError('System role name cannot be changed', 400));

  // const membersWithRole = await OrganizationMember.countDocuments({ role: role._id, isDeleted: { $ne: true } });
  const membersWithRole = 0;
  if (membersWithRole > 0) return next(new AppError('Cannot delete role while members are assigned. Reassign or remove members first.', 400));

  await OrgRole.updateOne(
    { _id: role._id, isDeleted: { $ne: true } },
    { $set: getSoftDeleteStamp(req) }
  );
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: 'delete',
    entity: 'organization_role',
    entityId: role._id?.toString?.(),
    orgId: req.params.orgId,
  });
  res.status(204).json({ status: true, message: 'Role deleted', data: null });
});
