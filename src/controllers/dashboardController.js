import { asyncHandler } from "../middleware/errorHandler.js";
import { getCurrentUserOrgId } from "../utils/organizationHelper.js";
import OrgDashboardSettings from "../models/OrgDashboardSettings.js";
import Stream from "../models/Stream.js";
import Clip from "../models/Clip.js";
import Folder from "../models/Folder.js";
import {
  buildScopeMatch,
  getMergedMediaFeed,
} from "./mediaLibraryController.js";
import { shouldIncludeDeleted } from "../utils/softDelete.js";
import { getAuditStamp } from "../utils/requestContext.js";
import { buildBaseAuditFromRequest, writeAuditLog } from "../services/auditLogService.js";

/**
 * GET /api/dashboard/settings
 * Returns dashboard settings for the current user's organization (e.g. visible filter IDs).
 * Requires auth; uses first org of the user. Returns empty visibleFilters if none saved.
 */
export const getDashboardSettings = asyncHandler(async (req, res) => {
  const orgId = await getCurrentUserOrgId(req);
  if (!orgId) {
    return res.status(200).json({
      status: "success",
      data: { visibleFilters: [] },
    });
  }

  const doc = await OrgDashboardSettings.findOne({
    organization: orgId,
  }).lean();
  const visibleFilters = Array.isArray(doc?.visibleFilters)
    ? doc.visibleFilters
    : [];

  res.status(200).json({
    status: "success",
    data: { visibleFilters },
  });
});

/**
 * PATCH /api/dashboard/settings
 * Body: { visibleFilters: string[] }
 * Updates dashboard settings for the current user's organization.
 */
export const updateDashboardSettings = asyncHandler(async (req, res) => {
  const orgId = await getCurrentUserOrgId(req);
  if (!orgId) {
    return res.status(400).json({
      status: "fail",
      message:
        "No organization context. Join an organization to save dashboard settings.",
    });
  }

  const visibleFilters = Array.isArray(req.body?.visibleFilters)
    ? req.body.visibleFilters.filter((id) => typeof id === "string")
    : [];

  const doc = await OrgDashboardSettings.findOneAndUpdate(
    { organization: orgId },
    { visibleFilters, updatedAt: new Date(), ...getAuditStamp(req) },
    { new: true, upsert: true, runValidators: true },
  );
  writeAuditLog({
    ...buildBaseAuditFromRequest(req),
    action: "update",
    entity: "dashboard_settings",
    entityId: doc?._id?.toString?.(),
    orgId,
    metadata: { fields: ["visibleFilters"] },
  });

  res.status(200).json({
    status: "success",
    data: { visibleFilters: doc.visibleFilters },
  });
});

/**
 * GET /api/dashboard/feed
 * Single dashboard API: returns streams + clips + highlights in one response.
 * No need to call /api/streams and /api/media-library separately.
 * Query: page, limit (for media items), streamLimit (max streams to return).
 */
export const getDashboardFeed = asyncHandler(async (req, res) => {
  const orgId = await getCurrentUserOrgId(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const streamLimit = Math.min(
    50,
    Math.max(1, parseInt(req.query.streamLimit, 10) || 20),
  );

  const effectiveOrgId = orgId ? orgId : null;
  const reqUserId = req.user?.userId;

  if (!effectiveOrgId && !reqUserId) {
    return res.status(400).json({
      status: "fail",
      message: "Organization or user context required",
    });
  }

  const streamMatch = {};
  if (effectiveOrgId) streamMatch.organization = effectiveOrgId;
  else streamMatch.userId = reqUserId;

  const scope = buildScopeMatch({
    effectiveOrgId,
    reqUserId,
    queryUserId: null,
    streamIdsArr: [],
    streamsOnly: false,
    includeDeleted:
      shouldIncludeDeleted(req) && req.user?.role === "superadmin",
  });
  if (scope.error) {
    return res.status(400).json({ status: "fail", message: scope.error });
  }

  const [streams, { items, total: totalMedia }, totalStreams] =
    await Promise.all([
      Stream.find(streamMatch)
        .sort({ createdAt: -1 })
        .limit(streamLimit)
        .select(
          "streamId title category status thumb_url defaultThumbnailUrl videoThumbnailUrl createdAt userId duration clipsCount highlightsCount matchId",
        )
        .lean(),
      getMergedMediaFeed(scope.clipMatch, scope.folderMatch, {
        skip: (page - 1) * limit,
        limit,
        sortBy: "latest",
      }),
      Stream.countDocuments(streamMatch),
    ]);

  const [totalClips, totalHighlights] = await Promise.all([
    Clip.countDocuments(scope.clipMatch),
    Folder.countDocuments(scope.folderMatch),
  ]);

  res.status(200).json({
    status: "success",
    data: {
      streams,
      items,
      stats: {
        totalStreams,
        totalClips,
        totalHighlights,
      },
      pagination: {
        page,
        limit,
        total: totalMedia,
        totalPages: Math.ceil(totalMedia / limit),
      },
    },
  });
});
