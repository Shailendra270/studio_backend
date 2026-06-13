/**
 * Media Library API: unified list of clips and highlights (folders) with optional DSG match enrichment.
 * Org-scoped; optional filters by streamIds, userId.
 */
import Clip from "../models/Clip.js";
import Folder from "../models/Folder.js";
import Stream from "../models/Stream.js";
import MatchMetadata from "../models/MatchMetadata.js";
import Tag from "../models/Tag.js";
import mongoose from "mongoose";
import logger from "../utils/logger.js";
import { getCurrentUserOrgId } from "../utils/organizationHelper.js";
import { fetchAndParseMatchMetadata } from "../services/dsgMatchService.js";
import { shouldIncludeDeleted } from "../utils/softDelete.js";

const BACKFILL_MATCH_METADATA_LIMIT = 5;

/**
 * Fire-and-forget: backfill MatchMetadata for matchIds that have no cached doc.
 * Uses DSG API and upserts so future filter counts and list enrichment include existing streams.
 * @param {{ matchIdsStr: string[], matchedStreams: Array<{ matchId?: string, streamId?: string, organization?: unknown, category?: string }>, effectiveOrgId: mongoose.Types.ObjectId | null }} opts
 */
function backfillMatchMetadataForMatchIds(opts) {
  const { matchIdsStr, matchedStreams, effectiveOrgId } = opts;
  if (!matchIdsStr?.length) return;

  const streamByMatchId = new Map();
  if (matchedStreams?.length) {
    matchedStreams.forEach((s) => {
      if (s?.matchId && !streamByMatchId.has(String(s.matchId).trim()))
        streamByMatchId.set(String(s.matchId).trim(), {
          streamId: s.streamId || "",
          organization: s.organization,
          category:
            (s.category || "others") === "football"
              ? "soccer"
              : s.category || "others",
        });
    });
  }

  (async () => {
    const needStreams =
      streamByMatchId.size < matchIdsStr.length && effectiveOrgId;
    const [existingMatchIds, streamsFromDb] = await Promise.all([
      MatchMetadata.find({ matchId: { $in: matchIdsStr } })
        .select("matchId")
        .lean()
        .then((docs) => docs.map((d) => String(d.matchId).trim())),
      needStreams
        ? Stream.find({
            organization: effectiveOrgId,
            matchId: { $in: matchIdsStr },
          })
            .select("matchId streamId organization category")
            .lean()
        : [],
    ]);
    if (Array.isArray(streamsFromDb)) {
      streamsFromDb.forEach((s) => {
        if (s?.matchId && !streamByMatchId.has(String(s.matchId).trim()))
          streamByMatchId.set(String(s.matchId).trim(), {
            streamId: s.streamId || "",
            organization: s.organization,
            category:
              (s.category || "others") === "football"
                ? "soccer"
                : s.category || "others",
          });
      });
    }
    const existingSet = new Set(existingMatchIds);
    const missing = matchIdsStr.filter((id) => !existingSet.has(id));
    const toBackfill = missing.slice(0, BACKFILL_MATCH_METADATA_LIMIT);
    toBackfill.forEach((matchId) => {
      const ctx = streamByMatchId.get(matchId) || {};
      const category = ctx.category || "soccer";
      fetchAndParseMatchMetadata(matchId, category)
        .then((payload) =>
          MatchMetadata.findOneAndUpdate(
            { matchId },
            {
              $set: {
                streamId: ctx.streamId || "",
                organization: ctx.organization || effectiveOrgId || null,
                category: ctx.category || "",
                payload,
                updatedAt: new Date(),
              },
            },
            { upsert: true, new: true },
          ),
        )
        .catch((err) =>
          logger.warn(
            "Match metadata backfill failed for",
            matchId,
            err?.message || err,
          ),
        );
    });
  })().catch((err) =>
    logger.warn("Match metadata backfill setup failed", err?.message || err),
  );
}

/**
 * Fire-and-forget: repair MatchMetadata records that have organization=null
 * by linking them to the correct org via matchId -> Stream.matchId -> Stream.organization.
 */
const _repairedOrgs = new Set();
function repairMatchMetadataOrg({ matchIdsStr, effectiveOrgId }) {
  if (!effectiveOrgId || !matchIdsStr?.length) return;
  const orgKey = String(effectiveOrgId);
  if (_repairedOrgs.has(orgKey)) return;
  _repairedOrgs.add(orgKey);

  (async () => {
    const orphaned = await MatchMetadata.find({
      matchId: { $in: matchIdsStr },
      $or: [{ organization: null }, { organization: { $exists: false } }],
    })
      .select("matchId")
      .lean();
    if (!orphaned.length) return;
    const orphanedIds = orphaned.map((d) => d.matchId);
    await MatchMetadata.updateMany(
      { matchId: { $in: orphanedIds } },
      { $set: { organization: effectiveOrgId } },
    );
    logger.info(
      `Repaired organization on ${orphaned.length} MatchMetadata records for org ${orgKey}`,
    );
  })().catch((err) =>
    logger.warn("MatchMetadata org repair failed", err?.message || err),
  );
}

function durationToLabel(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "00:00";
  const s = Math.max(0, Math.floor(Number(seconds)));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ss = s % 60;
  if (h > 0)
    return `${h}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function clipStatusToDownloadStatus(clipStatus) {
  const s = (clipStatus || "").toUpperCase();
  if (s === "COMPLETED") return "Ready";
  if (s === "PROCESSING") return "Processing";
  if (s === "FAILED") return "Failed";
  if (s === "CANCELLED") return "Cancelled";
  return s || "Ready";
}

function formatMatchDate(val) {
  if (val == null || val === "") return "";
  if (typeof val === "string") return val;
  try {
    return new Date(val).toISOString().slice(0, 10);
  } catch (_) {
    return "";
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toStringArray(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => toStringArray(entry));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean);
      }
    } catch (_) {
      // fall through to comma separated parsing
    }
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

function toNumberArray(value) {
  return toStringArray(value)
    .map((entry) => Number(entry))
    .filter((entry) => !Number.isNaN(entry));
}

function normalizeValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function matchesText(value, selectedValues) {
  if (!selectedValues.length) return true;
  const normalized = normalizeValue(value);
  if (!normalized) return false;
  return selectedValues.some(
    (selected) => normalized === normalizeValue(selected),
  );
}

function matchesTextArray(values, selectedValues) {
  if (!selectedValues.length) return true;
  const normalizedValues = new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeValue(value))
      .filter(Boolean),
  );
  return selectedValues.some((selected) =>
    normalizedValues.has(normalizeValue(selected)),
  );
}

function matchesNumber(value, selectedValues) {
  if (!selectedValues.length) return true;
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return false;
  return selectedValues.includes(numericValue);
}

function matchesDateRange(value, startDate, endDate) {
  if (!startDate && !endDate) return true;
  const normalized = formatMatchDate(value);
  if (!normalized) return false;
  if (startDate && normalized < startDate) return false;
  if (endDate && normalized > endDate) return false;
  return true;
}

function countValues(values, key) {
  const counts = new Map();
  values.forEach((value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ [key]: label, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a[key]).localeCompare(String(b[key]));
    });
}

function isMatchMetadataIncomplete(doc) {
  const payload = doc?.payload || {};
  const teams = Array.isArray(payload.teams)
    ? payload.teams.filter(Boolean)
    : [];
  return (
    !String(payload.matchName || "").trim() ||
    !String(payload.competition || "").trim() ||
    teams.length === 0
  );
}

function sortMediaItems(items, sortBy) {
  const sorted = [...items];
  switch (sortBy) {
    case "oldest":
      sorted.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      break;
    case "rating":
      sorted.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
      break;
    case "duration":
      sorted.sort(
        (a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0),
      );
      break;
    case "latest":
    default:
      sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      break;
  }
  return sorted;
}

export function buildScopeMatch({
  effectiveOrgId,
  reqUserId,
  queryUserId,
  streamIdsArr,
  streamsOnly,
  includeDeleted = false,
}) {
  // Exclude soft-deleted clips from list, stats, and filter counts
  const clipMatch = includeDeleted ? {} : { isDeleted: { $ne: true } };
  const folderMatch = includeDeleted
    ? { type: "highlight" }
    : { type: "highlight", isDeleted: { $ne: true }, status: { $ne: "deleted" } };

  if (effectiveOrgId) {
    clipMatch.organization = effectiveOrgId;
    folderMatch.organization = effectiveOrgId;
  } else if (reqUserId) {
    clipMatch.userId = reqUserId;
    folderMatch.userId = reqUserId;
  } else {
    return { error: "Organization or user context required" };
  }

  if (queryUserId) {
    clipMatch.userId = queryUserId;
    folderMatch.userId = queryUserId;
  }

  if (streamIdsArr && streamIdsArr.length) {
    clipMatch.streamId = { $in: streamIdsArr };
    folderMatch.streamId = { $in: streamIdsArr };
  } else if (streamsOnly === "true" || streamsOnly === true) {
    clipMatch.streamId = { $exists: true, $nin: [null, ""] };
    folderMatch.streamId = { $exists: true, $nin: [null, ""] };
  }

  return { clipMatch, folderMatch };
}

/**
 * Return streamIds that still exist in the Stream collection (streams are hard-deleted, so
 * clips/folders with a deleted stream would otherwise still be counted/listed).
 */
async function getExistingStreamIdsForScope(effectiveOrgId, reqUserId, queryUserId, streamIdsArr) {
  const streamScopeMatch = {};
  if (effectiveOrgId) streamScopeMatch.organization = effectiveOrgId;
  else if (reqUserId) streamScopeMatch.userId = reqUserId;
  else return [];
  if (queryUserId) streamScopeMatch.userId = queryUserId;
  let ids = await Stream.distinct("streamId", streamScopeMatch);
  if (streamIdsArr?.length) ids = ids.filter((id) => streamIdsArr.includes(id));
  return ids;
}

async function loadStreamsAndMeta(streamIdsToLoad) {
  if (!streamIdsToLoad || streamIdsToLoad.length === 0) {
    return { streamMap: new Map(), getMatchPayload: () => null };
  }

  const streams = await Stream.find({ streamId: { $in: streamIdsToLoad } })
    .select("streamId title matchId matchDate category source status")
    .lean();
  const streamMap = new Map(streams.map((stream) => [stream.streamId, stream]));
  const matchIds = [
    ...new Set(streams.map((stream) => stream.matchId).filter(Boolean)),
  ];
  const [matchMetaByMatchId, matchMetaByStreamId] = await Promise.all([
    matchIds.length
      ? MatchMetadata.find({ matchId: { $in: matchIds } }).lean()
      : [],
    MatchMetadata.find({ streamId: { $in: streamIdsToLoad } }).lean(),
  ]);
  const matchMap = new Map(
    matchMetaByMatchId.map((entry) => [entry.matchId, entry.payload || entry]),
  );
  const matchByStreamIdMap = new Map(
    matchMetaByStreamId
      .filter((entry) => entry.streamId)
      .map((entry) => [entry.streamId, entry.payload || entry]),
  );

  const getMatchPayload = (stream) => {
    if (!stream) return null;
    if (stream.matchId && matchMap.has(stream.matchId))
      return matchMap.get(stream.matchId);
    return matchByStreamIdMap.get(stream.streamId) || null;
  };

  return { streamMap, getMatchPayload };
}

async function loadMappedMediaItems({ clipMatch, folderMatch, mediaType }) {
  const [clips, folders] = await Promise.all([
    mediaType === "highlight"
      ? Promise.resolve([])
      : Clip.find(clipMatch).lean(),
    mediaType === "clip"
      ? Promise.resolve([])
      : Folder.find(folderMatch).lean(),
  ]);

  const streamIdsToLoad = [
    ...new Set([
      ...clips.map((clip) => clip.streamId).filter(Boolean),
      ...folders.map((folder) => folder.streamId).filter(Boolean),
    ]),
  ];

  const { streamMap, getMatchPayload } =
    await loadStreamsAndMeta(streamIdsToLoad);

  return [
    ...clips.map((clip) => {
      const stream = streamMap.get(clip.streamId);
      return toMediaItemFromClip(clip, stream, getMatchPayload(stream));
    }),
    ...folders.map((folder) => {
      const stream = streamMap.get(folder.streamId);
      return toMediaItemFromFolder(folder, stream, getMatchPayload(stream));
    }),
  ];
}

function buildFilterState(query) {
  return {
    search: typeof query.search === "string" ? query.search.trim() : "",
    mediaTypes: toStringArray(query.mediaTypes),
    aspectRatios: toStringArray(query.aspectRatio),
    tags: toStringArray(query.tags),
    ratings: toNumberArray(query.rating),
    clipStatuses: toStringArray(query.clipStatus || query.status),
    downloadStatuses: toStringArray(query.downloadStatus),
    categoryValues: toStringArray(query.category),
    platformValues: toStringArray(query.platform),
    sourceValues: toStringArray(query.source),
    playerValues: toStringArray(query.players),
    actionValues: toStringArray(query.actions),
    streamValues: toStringArray(query.streams),
    seasonValues: toStringArray(query.season),
    competitionValues: toStringArray(query.competition),
    matchDayValues: toStringArray(query.matchDay),
    matchDateValues: toStringArray(query.matchDate),
    matchValues: toStringArray(query.matches),
    teamValues: toStringArray(query.teams),
    venueValues: toStringArray(query.venues),
    startDate: query.startDate ? String(query.startDate) : "",
    endDate: query.endDate ? String(query.endDate) : "",
  };
}

/** Hierarchy: Sport → Competition → Season → Round → Date → Matches → Teams → Venues. Returns filters with only parents set for the given dimension. */
function filtersForLeagueEventDimension(filters, dimension) {
  const empty = [];
  const dims = {
    competition: {
      competitionValues: empty,
      seasonValues: empty,
      matchDayValues: empty,
      matchDateValues: empty,
      matchValues: empty,
      teamValues: empty,
      venueValues: empty,
    },
    season: {
      seasonValues: empty,
      matchDayValues: empty,
      matchDateValues: empty,
      matchValues: empty,
      teamValues: empty,
      venueValues: empty,
    },
    matchDay: {
      matchDayValues: empty,
      matchDateValues: empty,
      matchValues: empty,
      teamValues: empty,
      venueValues: empty,
    },
    matchDate: {
      matchDateValues: empty,
      matchValues: empty,
      teamValues: empty,
      venueValues: empty,
    },
    matches: {
      matchValues: empty,
      teamValues: empty,
      venueValues: empty,
    },
    teams: {
      teamValues: empty,
      venueValues: empty,
    },
    venues: {
      venueValues: empty,
    },
  };
  const clear = dims[dimension];
  if (!clear) return filters;
  return { ...filters, ...clear };
}

const RESPONSE_CACHE_TTL_MS = 15000;
const responseCache = new Map();

function getCachedResponse(cacheKey) {
  const cached = responseCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedResponse(cacheKey, value, ttlMs = RESPONSE_CACHE_TTL_MS) {
  responseCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/** Invalidate media library list cache so next request gets fresh data (e.g. after delete). */
export function invalidateMediaLibraryListCache() {
  for (const key of responseCache.keys()) {
    if (String(key).startsWith("list:")) responseCache.delete(key);
  }
}

function exactRegexList(values) {
  return values.map((value) => new RegExp(`^${escapeRegex(value)}$`, "i"));
}

/** Expand sport/category for matching: Football <-> football, soccer so dropdown selection matches DB values. */
function expandCategoryValues(values) {
  if (!values?.length) return values;
  const out = new Set(values.map((v) => String(v).trim()).filter(Boolean));
  values.forEach((v) => {
    const lower = String(v).toLowerCase();
    if (lower === "football") {
      out.add("soccer");
      out.add("football");
    }
    if (lower === "soccer") {
      out.add("football");
      out.add("soccer");
    }
  });
  return [...out];
}

function intersectIds(currentIds, nextIds) {
  if (!nextIds) return currentIds;
  const normalizedNext = [...new Set(nextIds.filter(Boolean))];
  if (currentIds == null) return normalizedNext;
  const nextSet = new Set(normalizedNext);
  return currentIds.filter((id) => nextSet.has(id));
}

function mergeCountRecords(groups, key) {
  const merged = new Map();
  groups.flat().forEach((entry) => {
    const label = String(entry?.[key] ?? "").trim();
    if (!label) return;
    merged.set(label, (merged.get(label) || 0) + Number(entry.count || 0));
  });
  return [...merged.entries()]
    .map(([label, count]) => ({ [key]: label, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a[key]).localeCompare(String(b[key]));
    });
}

async function resolveStreamContext({
  effectiveOrgId,
  reqUserId,
  queryUserId,
  streamIdsArr,
  filters,
}) {
  const streamScopeMatch = {};
  if (effectiveOrgId) streamScopeMatch.organization = effectiveOrgId;
  else if (reqUserId) streamScopeMatch.userId = reqUserId;
  if (queryUserId) streamScopeMatch.userId = queryUserId;
  if (streamIdsArr.length) streamScopeMatch.streamId = { $in: streamIdsArr };

  const needsScopedStreams =
    streamIdsArr.length > 0 ||
    filters.streamValues.length > 0 ||
    filters.categoryValues.length > 0 ||
    filters.seasonValues.length > 0 ||
    filters.competitionValues.length > 0 ||
    filters.matchDayValues.length > 0 ||
    filters.matchDateValues.length > 0 ||
    filters.matchValues.length > 0 ||
    filters.teamValues.length > 0 ||
    filters.venueValues.length > 0 ||
    Boolean(filters.search);

  const scopedStreams = needsScopedStreams
    ? await Stream.find(streamScopeMatch)
        .select("streamId matchId title category")
        .lean()
    : [];

  const scopedStreamIds = scopedStreams
    .map((stream) => stream.streamId)
    .filter(Boolean);
  const matchIdToStreamIds = new Map();
  scopedStreams.forEach((stream) => {
    if (!stream.matchId) return;
    const existing = matchIdToStreamIds.get(stream.matchId) || [];
    existing.push(stream.streamId);
    matchIdToStreamIds.set(stream.matchId, existing);
  });

  let allowedStreamIds = streamIdsArr.length ? [...streamIdsArr] : null;

  if (filters.streamValues.length) {
    const allowedByTitle = scopedStreams
      .filter((stream) => matchesText(stream.title, filters.streamValues))
      .map((stream) => stream.streamId);
    allowedStreamIds = intersectIds(allowedStreamIds, allowedByTitle);
  }

  if (filters.categoryValues.length) {
    const categoryMatchValues = expandCategoryValues(filters.categoryValues);
    const allowedByCategory = scopedStreams
      .filter((stream) => matchesText(stream.category, categoryMatchValues))
      .map((stream) => stream.streamId);
    allowedStreamIds = intersectIds(allowedStreamIds, allowedByCategory);
  }

  const metadataNeedsFilter =
    filters.seasonValues.length > 0 ||
    filters.competitionValues.length > 0 ||
    filters.matchDayValues.length > 0 ||
    filters.matchDateValues.length > 0 ||
    filters.matchValues.length > 0 ||
    filters.teamValues.length > 0 ||
    filters.venueValues.length > 0 ||
    Boolean(filters.search);

  let searchStreamIds = [];
  if (metadataNeedsFilter) {
    const metaMatch = {};
    if (effectiveOrgId) metaMatch.organization = effectiveOrgId;
    if (filters.seasonValues.length)
      metaMatch["payload.season"] = {
        $in: exactRegexList(filters.seasonValues),
      };
    if (filters.competitionValues.length)
      metaMatch["payload.competition"] = {
        $in: exactRegexList(filters.competitionValues),
      };
    if (filters.matchDayValues.length)
      metaMatch["payload.matchDay"] = {
        $in: exactRegexList(filters.matchDayValues),
      };
    if (filters.matchDateValues.length)
      metaMatch["payload.matchDate"] = { $in: filters.matchDateValues };
    if (filters.matchValues.length)
      metaMatch["payload.matchName"] = {
        $in: exactRegexList(filters.matchValues),
      };
    if (filters.teamValues.length)
      metaMatch["payload.teams"] = { $in: exactRegexList(filters.teamValues) };
    if (filters.venueValues.length)
      metaMatch["payload.venue"] = { $in: exactRegexList(filters.venueValues) };

    if (filters.search) {
      const searchRe = new RegExp(escapeRegex(filters.search), "i");
      metaMatch.$or = [
        { "payload.matchName": searchRe },
        { "payload.venue": searchRe },
        { "payload.competition": searchRe },
        { "payload.season": searchRe },
        { "payload.teams": searchRe },
      ];
    }

    const metaDocs = await MatchMetadata.find(metaMatch)
      .select("streamId matchId")
      .lean();
    const matchedByMetadata = new Set();
    metaDocs.forEach((doc) => {
      if (doc.streamId) matchedByMetadata.add(doc.streamId);
      const streamIds = matchIdToStreamIds.get(doc.matchId) || [];
      streamIds.forEach((streamId) => matchedByMetadata.add(streamId));
    });

    if (
      filters.seasonValues.length ||
      filters.competitionValues.length ||
      filters.matchDayValues.length ||
      filters.matchDateValues.length ||
      filters.matchValues.length ||
      filters.teamValues.length ||
      filters.venueValues.length
    ) {
      allowedStreamIds = intersectIds(allowedStreamIds, [...matchedByMetadata]);
      if (scopedStreamIds.length)
        allowedStreamIds = intersectIds(allowedStreamIds, scopedStreamIds);
    }

    if (filters.search) {
      const searchRe = new RegExp(escapeRegex(filters.search), "i");
      const streamMatches = scopedStreams
        .filter(
          (stream) =>
            searchRe.test(String(stream.title || "")) ||
            searchRe.test(String(stream.category || "")),
        )
        .map((stream) => stream.streamId);
      searchStreamIds = [...new Set([...matchedByMetadata, ...streamMatches])];
    }
  } else if (filters.search) {
    const searchRe = new RegExp(escapeRegex(filters.search), "i");
    searchStreamIds = scopedStreams
      .filter(
        (stream) =>
          searchRe.test(String(stream.title || "")) ||
          searchRe.test(String(stream.category || "")),
      )
      .map((stream) => stream.streamId);
  }

  return {
    streamScopeMatch,
    allowedStreamIds,
    searchStreamIds,
  };
}

function applyDatabaseFilterState({
  clipMatch,
  folderMatch,
  filters,
  allowedStreamIds,
  searchStreamIds,
}) {
  function setClipStatuses(nextStatuses) {
    if (!nextStatuses.length) {
      clipMatch._id = { $in: [] };
      return;
    }
    const existing = clipMatch.clipStatus?.$in;
    clipMatch.clipStatus = {
      $in: existing
        ? existing.filter((status) => nextStatuses.includes(status))
        : nextStatuses,
    };
  }

  if (allowedStreamIds !== null && allowedStreamIds !== undefined) {
    clipMatch.streamId = { $in: allowedStreamIds };
    folderMatch.streamId = { $in: allowedStreamIds };
  }

  if (filters.aspectRatios.length) {
    clipMatch.aspectRatio = { $in: filters.aspectRatios };
    folderMatch.aspectRatio = { $in: filters.aspectRatios };
  }
  if (filters.ratings.length) {
    clipMatch.rating = { $in: filters.ratings };
    folderMatch.rating = { $in: filters.ratings };
  }
  if (filters.playerValues.length) {
    const playerRegexList = exactRegexList(filters.playerValues);
    // Match clips that have player in customData.players OR in tags (same as filter-counts).
    clipMatch.$and = [
      ...(clipMatch.$and || []),
      {
        $or: [
          { "customData.players": { $in: playerRegexList } },
          { tags: { $in: playerRegexList } },
        ],
      },
    ];
    folderMatch._id = folderMatch._id ?? { $in: [] };
  }

  const tagFilters = [...new Set([...filters.tags, ...filters.actionValues])];
  if (tagFilters.length) {
    const regexList = exactRegexList(tagFilters);
    clipMatch.tags = { $in: regexList };
    folderMatch.tags = { $in: regexList };
  }

  if (filters.platformValues.length) {
    clipMatch["clipPublished.platform"] = {
      $in: exactRegexList(filters.platformValues),
    };
    folderMatch._id = { $in: [] };
  }

  if (filters.clipStatuses.length) {
    const statuses = filters.clipStatuses.map((status) =>
      String(status).toUpperCase(),
    );
    setClipStatuses(statuses);
    if (!statuses.includes("COMPLETED")) folderMatch._id = { $in: [] };
  }

  if (filters.downloadStatuses.length) {
    const normalized = filters.downloadStatuses.map((status) =>
      normalizeValue(status),
    );
    const clipStatuses = [];
    if (normalized.includes("ready")) clipStatuses.push("COMPLETED");
    if (normalized.includes("processing")) clipStatuses.push("PROCESSING");
    if (normalized.includes("failed")) clipStatuses.push("FAILED");
    if (normalized.includes("cancelled")) clipStatuses.push("CANCELLED");
    setClipStatuses(clipStatuses);
    if (!normalized.includes("ready")) folderMatch._id = { $in: [] };
  }

  if (filters.sourceValues.length) {
    const wantsAi = filters.sourceValues.some(
      (value) => normalizeValue(value) === "ai",
    );
    const wantsManual = filters.sourceValues.some(
      (value) => normalizeValue(value) === "manual",
    );
    if (wantsAi && !wantsManual) {
      clipMatch.$and = [
        ...(clipMatch.$and || []),
        { $or: [{ isAiCreated: true }, { isManual: false }] },
      ];
      folderMatch.isAiCreated = true;
    } else if (wantsManual && !wantsAi) {
      clipMatch.$and = [
        ...(clipMatch.$and || []),
        { isAiCreated: { $ne: true } },
        { isManual: { $ne: false } },
      ];
      folderMatch.isAiCreated = { $ne: true };
    }
  }

  if (filters.mediaTypes.length) {
    const normalized = filters.mediaTypes.map((value) => normalizeValue(value));
    const wantsHighlights =
      normalized.includes("highlights") || normalized.includes("highlight");
    const wantsAiClips = normalized.includes("ai clips");
    const wantsManualClips = normalized.includes("manual clips");

    if (!wantsHighlights) {
      folderMatch._id = { $in: [] };
    }
    if (wantsHighlights && !wantsAiClips && !wantsManualClips) {
      clipMatch._id = { $in: [] };
    } else if (!wantsAiClips && !wantsManualClips && !wantsHighlights) {
      clipMatch._id = { $in: [] };
    } else if (wantsAiClips && !wantsManualClips) {
      clipMatch.$and = [
        ...(clipMatch.$and || []),
        { isHighlightVideo: { $ne: true } },
        { $or: [{ isAiCreated: true }, { isManual: false }] },
      ];
    } else if (wantsManualClips && !wantsAiClips) {
      clipMatch.$and = [
        ...(clipMatch.$and || []),
        { isHighlightVideo: { $ne: true } },
        { isAiCreated: { $ne: true } },
        { isManual: { $ne: false } },
      ];
    }
  }

  if (filters.search) {
    const searchRe = new RegExp(escapeRegex(filters.search), "i");
    clipMatch.$or = [
      { title: searchRe },
      { description: searchRe },
      { streamTitle: searchRe },
      { tags: searchRe },
      { "customData.players": searchRe },
      ...(searchStreamIds.length
        ? [{ streamId: { $in: searchStreamIds } }]
        : []),
    ];
    folderMatch.$or = [
      { title: searchRe },
      { tags: searchRe },
      ...(searchStreamIds.length
        ? [{ streamId: { $in: searchStreamIds } }]
        : []),
    ];
  }

  if (filters.categoryValues.length) {
    const categoryMatchValues = expandCategoryValues(filters.categoryValues);
    folderMatch.$and = [
      ...(folderMatch.$and || []),
      {
        $or: [
          { category: { $in: exactRegexList(categoryMatchValues) } },
          ...(allowedStreamIds
            ? [{ streamId: { $in: allowedStreamIds } }]
            : []),
        ],
      },
    ];
  }
}

function applyMediaFilters(items, filters) {
  const searchTerm = normalizeValue(filters.search);

  return items.filter((item) => {
    if (searchTerm) {
      const haystack = [
        item.title,
        item.matchName,
        item.stream,
        item.mediaType,
        item.venue,
        item.competition,
        item.season,
        item.matchDay,
        item.source,
        item.platform,
        ...(item.teams || []),
        ...(item.players || []),
        ...(item.tags || []),
        ...(item.actions || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    if (!matchesText(item.mediaType, filters.mediaTypes)) return false;
    if (!matchesText(item.aspectRatio || item.ratio, filters.aspectRatios))
      return false;
    if (
      !matchesText(item.category, expandCategoryValues(filters.categoryValues))
    )
      return false;
    if (!matchesText(item.source, filters.sourceValues)) return false;
    if (!matchesText(item.platform, filters.platformValues)) return false;
    if (!matchesText(item.clipStatus, filters.clipStatuses)) return false;
    if (!matchesText(item.downloadStatus, filters.downloadStatuses))
      return false;
    if (!matchesNumber(item.rating, filters.ratings)) return false;
    if (!matchesText(item.season, filters.seasonValues)) return false;
    if (!matchesText(item.competition, filters.competitionValues)) return false;
    if (!matchesText(item.matchDate, filters.matchDateValues)) return false;
    if (!matchesText(item.matchName, filters.matchValues)) return false;
    if (!matchesText(item.stream, filters.streamValues)) return false;
    if (!matchesText(item.venue, filters.venueValues)) return false;
    if (!matchesTextArray(item.players, filters.playerValues)) return false;
    if (!matchesTextArray(item.actions, filters.actionValues)) return false;
    if (!matchesTextArray(item.tags, filters.tags)) return false;
    if (!matchesTextArray(item.teams, filters.teamValues)) return false;
    if (!matchesDateRange(item.matchDate, filters.startDate, filters.endDate))
      return false;

    return true;
  });
}

function toMediaItemFromClip(clip, stream, matchPayload) {
  const streamTitle = stream?.title || clip.streamTitle || "";
  const matchName = matchPayload?.matchName || "";
  const matchDate =
    formatMatchDate(matchPayload?.matchDate) ||
    formatMatchDate(stream?.matchDate) ||
    "";
  const teams = matchPayload?.teams || [];
  const venue = matchPayload?.venue || "";
  const competition = matchPayload?.competition ?? "";
  const season = matchPayload?.season ?? "";
  const matchDay = matchPayload?.matchDay ?? matchPayload?.session ?? "";
  const scoreA = matchPayload?.scoreA;
  const scoreB = matchPayload?.scoreB;
  const scoreLabel =
    scoreA != null && scoreB != null ? `${scoreA}-${scoreB}` : "";
  const category = stream?.category || clip?.customData?.sportName || "";
  const source =
    clip.isAiCreated === true
      ? "AI"
      : clip.isManual === false
        ? "AI"
        : "Manual";
  const platform =
    Array.isArray(clip.clipPublished) && clip.clipPublished[0]
      ? clip.clipPublished[0].platform || ""
      : "";
  const players = Array.isArray(clip.customData?.players)
    ? clip.customData.players
    : [];
  const tags = Array.isArray(clip.tags) ? clip.tags : [];
  return {
    id: clip.id || clip._id?.toString(),
    type: "clip",
    title: clip.title || "",
    thumbnailUrl:
      clip.thumbnailUrl || clip.videoThumbnailUrl || clip.s3_thumb_url || "",
    videoUrl: clip.videoUrl || clip.s3_video_url || "",
    duration: clip.duration,
    durationLabel: durationToLabel(clip.duration),
    createdAt: clip.createdAt,
    streamId: clip.streamId,
    streamTitle,
    stream: streamTitle,
    category,
    aspectRatio: clip.aspectRatio || "16:9",
    ratio: clip.aspectRatio || "16:9",
    rating: clip.rating ?? 0,
    clipStatus:
      clip.clipStatus || (clip.status === 1 ? "COMPLETED" : "PROCESSING"),
    downloadStatus: clipStatusToDownloadStatus(clip.clipStatus),
    source,
    mediaType: clip.isHighlightVideo
      ? "Highlight"
      : source === "AI"
        ? "AI Clips"
        : "Manual Clips",
    platform,
    players,
    actions: tags,
    tags,
    matchId: stream?.matchId || "",
    matchName,
    matchDate,
    teams,
    venue,
    competition,
    season,
    scoreLabel,
    progress: clip.progress != null ? Number(clip.progress) : undefined,
  };
}

function toMediaItemFromFolder(folder, stream, matchPayload) {
  const streamTitle = stream?.title || "";
  const matchName = matchPayload?.matchName || "";
  const matchDate =
    formatMatchDate(matchPayload?.matchDate) ||
    formatMatchDate(stream?.matchDate) ||
    "";
  const teams = matchPayload?.teams || [];
  const venue = matchPayload?.venue || "";
  const competition = matchPayload?.competition ?? "";
  const season = matchPayload?.season ?? "";
  const matchDay = matchPayload?.matchDay ?? matchPayload?.session ?? "";
  const scoreA = matchPayload?.scoreA;
  const scoreB = matchPayload?.scoreB;
  const scoreLabel =
    scoreA != null && scoreB != null ? `${scoreA}-${scoreB}` : "";
  const category = stream?.category || folder?.category || "";
  const durationSec =
    folder.totalDuration != null ? Number(folder.totalDuration) : 0;
  const progressPercent = folder.progressPercent != null ? Number(folder.progressPercent) : 0;
  const statusVal = folder.status;
  const statusStr = typeof statusVal === "string"
    ? statusVal.toLowerCase()
    : (statusVal?.name && typeof statusVal.name === "string" ? statusVal.name.toLowerCase() : "");
  const isProcessing =
    statusStr === "processing" ||
    statusStr === "normalizing clips" ||
    (!folder.previewUrl && (progressPercent > 0 || statusStr === "processing") && progressPercent < 100);
  const clipStatus = isProcessing ? "PROCESSING" : "COMPLETED";
  const downloadStatus = isProcessing ? "Processing" : "Ready";
  return {
    id: folder._id?.toString(),
    type: "highlight",
    title: folder.title || "",
    thumbnailUrl:
      folder.thumbnail ||
      folder.previewUrl ||
      (folder.thumbnails && folder.thumbnails[0]) ||
      "",
    videoUrl: folder.previewUrl || "",
    duration: durationSec,
    durationLabel: durationToLabel(durationSec),
    createdAt: folder.createdAt,
    streamId: folder.streamId || "",
    streamTitle,
    stream: streamTitle,
    category,
    aspectRatio: folder.aspectRatio || "16:9",
    ratio: folder.aspectRatio || "16:9",
    rating: folder.rating ?? 0,
    clipStatus,
    downloadStatus,
    progressPercent: isProcessing ? progressPercent : undefined,
    source: folder.isAiCreated ? "AI" : "Manual",
    mediaType: "Highlights",
    platform: "",
    players: [],
    actions: Array.isArray(folder.tags) ? folder.tags : [],
    tags: Array.isArray(folder.tags) ? folder.tags : [],
    matchId: stream?.matchId || "",
    matchName,
    matchDate,
    teams,
    venue,
    competition,
    season,
    matchDay,
    scoreLabel,
  };
}

/**
 * GET /api/media-library
 * List clips and highlights (folders) with optional filters and DSG enrichment.
 */
export const getMediaLibraryList = async (req, res) => {
  try {
    const orgId = await getCurrentUserOrgId(req);
    const {
      organizationId,
      streamIds,
      userId: queryUserId,
      page = 1,
      limit = 20,
      sortBy = "latest",
      mediaType,
      streamsOnly,
    } = req.query;

    const effectiveOrgId = organizationId
      ? new mongoose.Types.ObjectId(organizationId)
      : orgId;
    const streamIdsArr = toStringArray(streamIds);
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;
    const cacheKey = `list:${String(effectiveOrgId || req.user?.userId || "")}:${JSON.stringify(req.query)}`;
    const cached = getCachedResponse(cacheKey);
    if (cached) return res.json(cached);
    const scope = buildScopeMatch({
      effectiveOrgId,
      reqUserId: req.user?.userId,
      queryUserId,
      streamIdsArr,
      streamsOnly,
      includeDeleted:
        shouldIncludeDeleted(req) && req.user?.role === "superadmin",
    });
    if (scope.error) {
      return res.status(400).json({ success: false, error: scope.error });
    }

    const filters = buildFilterState(req.query);
    const { allowedStreamIds: rawAllowedStreamIds, searchStreamIds } = await resolveStreamContext({
      effectiveOrgId,
      reqUserId: req.user?.userId,
      queryUserId,
      streamIdsArr,
      filters,
    });
    const existingStreamIds = await getExistingStreamIdsForScope(
      effectiveOrgId,
      req.user?.userId,
      queryUserId,
      streamIdsArr,
    );
    const allowedStreamIds =
      rawAllowedStreamIds?.length
        ? rawAllowedStreamIds.filter((id) => existingStreamIds.includes(id))
        : existingStreamIds;

    const clipMatch = { ...scope.clipMatch };
    const folderMatch = { ...scope.folderMatch };
    if (mediaType === "clip") folderMatch._id = { $in: [] };
    if (mediaType === "highlight") clipMatch._id = { $in: [] };
    applyDatabaseFilterState({
      clipMatch,
      folderMatch,
      filters,
      allowedStreamIds,
      searchStreamIds,
    });

    const sortOrder = sortBy === "oldest" ? 1 : -1;
    const sortObj =
      sortBy === "rating"
        ? { rating: -1, createdAt: -1 }
        : sortBy === "duration"
          ? { duration: -1, createdAt: -1 }
          : { createdAt: sortOrder };

    let items = [];
    let total = 0;

    if (mediaType === "clip") {
      const [clips, totalClips] = await Promise.all([
        Clip.find(clipMatch).sort(sortObj).skip(skip).limit(limitNum).lean(),
        Clip.countDocuments(clipMatch),
      ]);
      const streamIdsToLoad = [
        ...new Set(clips.map((clip) => clip.streamId).filter(Boolean)),
      ];
      const { streamMap, getMatchPayload } =
        await loadStreamsAndMeta(streamIdsToLoad);
      items = clips.map((clip) => {
        const stream = streamMap.get(clip.streamId);
        return toMediaItemFromClip(clip, stream, getMatchPayload(stream));
      });
      total = totalClips;
    } else if (mediaType === "highlight") {
      const [folders, totalFolders] = await Promise.all([
        Folder.find(folderMatch)
          .sort(sortObj)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Folder.countDocuments(folderMatch),
      ]);
      const streamIdsToLoad = [
        ...new Set(folders.map((folder) => folder.streamId).filter(Boolean)),
      ];
      const { streamMap, getMatchPayload } =
        await loadStreamsAndMeta(streamIdsToLoad);
      items = folders.map((folder) => {
        const stream = streamMap.get(folder.streamId);
        return toMediaItemFromFolder(folder, stream, getMatchPayload(stream));
      });
      total = totalFolders;
    } else {
      // "All" view: mix clips, highlights (folders), and AI clips by createdAt (one timeline)
      const [clipTotal, folderTotal] = await Promise.all([
        Clip.countDocuments(clipMatch),
        Folder.countDocuments(folderMatch),
      ]);
      total = clipTotal + folderTotal;

      const isDateSort = sortBy === "latest" || sortBy === "oldest";
      if (isDateSort) {
        // Single merged timeline by createdAt: union clips + folders, sort, skip, limit, then load full docs
        const sortOrderMongo = sortBy === "oldest" ? 1 : -1;
        const mergedPipeline = [
          { $match: clipMatch },
          {
            $project: {
              _id: 1,
              createdAt: 1,
              streamId: 1,
              itemType: { $literal: "clip" },
            },
          },
          {
            $unionWith: {
              coll: "cliplists",
              pipeline: [
                { $match: folderMatch },
                {
                  $project: {
                    _id: 1,
                    createdAt: 1,
                    streamId: 1,
                    itemType: { $literal: "highlight" },
                  },
                },
              ],
            },
          },
          { $sort: { createdAt: sortOrderMongo } },
          { $skip: skip },
          { $limit: limitNum },
        ];
        const mergedIds = await Clip.aggregate(mergedPipeline).exec();
        const clipIds = mergedIds
          .filter((r) => r.itemType === "clip")
          .map((r) => r._id);
        const folderIds = mergedIds
          .filter((r) => r.itemType === "highlight")
          .map((r) => r._id);

        const [clipsById, foldersById] = await Promise.all([
          clipIds.length ? Clip.find({ _id: { $in: clipIds } }).lean() : [],
          folderIds.length
            ? Folder.find({ _id: { $in: folderIds } }).lean()
            : [],
        ]);
        const clipMap = new Map(clipsById.map((c) => [c._id.toString(), c]));
        const folderMap = new Map(
          foldersById.map((f) => [f._id.toString(), f]),
        );

        const streamIdsToLoad = [
          ...new Set(mergedIds.map((r) => r.streamId).filter(Boolean)),
        ];
        const { streamMap, getMatchPayload } =
          await loadStreamsAndMeta(streamIdsToLoad);

        items = mergedIds
          .map((row) => {
            if (row.itemType === "clip") {
              const clip = clipMap.get(row._id.toString());
              if (!clip) return null;
              const stream = streamMap.get(clip.streamId);
              return toMediaItemFromClip(clip, stream, getMatchPayload(stream));
            }
            const folder = folderMap.get(row._id.toString());
            if (!folder) return null;
            const stream = streamMap.get(folder.streamId);
            return toMediaItemFromFolder(
              folder,
              stream,
              getMatchPayload(stream),
            );
          })
          .filter(Boolean);
      } else {
        // rating / duration: fetch enough from each, merge and sort in memory, then slice
        const fetchSize = 2 * (skip + limitNum);
        const [clips, folders] = await Promise.all([
          Clip.find(clipMatch).sort(sortObj).limit(fetchSize).lean(),
          Folder.find(folderMatch).sort(sortObj).limit(fetchSize).lean(),
        ]);
        const streamIdsToLoad = [
          ...new Set([
            ...clips.map((c) => c.streamId).filter(Boolean),
            ...folders.map((f) => f.streamId).filter(Boolean),
          ]),
        ];
        const { streamMap, getMatchPayload } =
          await loadStreamsAndMeta(streamIdsToLoad);
        const clipItems = clips.map((clip) => {
          const stream = streamMap.get(clip.streamId);
          return toMediaItemFromClip(clip, stream, getMatchPayload(stream));
        });
        const folderItems = folders.map((folder) => {
          const stream = streamMap.get(folder.streamId);
          return toMediaItemFromFolder(folder, stream, getMatchPayload(stream));
        });
        items = sortMediaItems([...clipItems, ...folderItems], sortBy).slice(
          skip,
          skip + limitNum,
        );
      }
    }

    const response = {
      success: true,
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
    setCachedResponse(cacheKey, response, 30000); // 30s cache for list (heavy query)
    return res.json(response);
  } catch (error) {
    logger.error("getMediaLibraryList error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

/**
 * Get merged media feed (clips + highlights) by createdAt for use by dashboard.
 * @param {object} clipMatch - Mongo match for Clip
 * @param {object} folderMatch - Mongo match for Folder (highlights)
 * @param {{ skip: number, limit: number, sortBy?: string }} opts
 * @returns Promise<{ items: object[], total: number }>
 */
export async function getMergedMediaFeed(
  clipMatch,
  folderMatch,
  { skip = 0, limit = 20, sortBy = "latest" },
) {
  const sortOrderMongo = sortBy === "oldest" ? 1 : -1;
  const total =
    (await Clip.countDocuments(clipMatch)) +
    (await Folder.countDocuments(folderMatch));
  const mergedPipeline = [
    { $match: clipMatch },
    {
      $project: {
        _id: 1,
        createdAt: 1,
        streamId: 1,
        itemType: { $literal: "clip" },
      },
    },
    {
      $unionWith: {
        coll: "cliplists",
        pipeline: [
          { $match: folderMatch },
          {
            $project: {
              _id: 1,
              createdAt: 1,
              streamId: 1,
              itemType: { $literal: "highlight" },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: sortOrderMongo } },
    { $skip: skip },
    { $limit: limit },
  ];
  const mergedIds = await Clip.aggregate(mergedPipeline).exec();
  const clipIds = mergedIds
    .filter((r) => r.itemType === "clip")
    .map((r) => r._id);
  const folderIds = mergedIds
    .filter((r) => r.itemType === "highlight")
    .map((r) => r._id);

  const [clipsById, foldersById] = await Promise.all([
    clipIds.length ? Clip.find({ _id: { $in: clipIds } }).lean() : [],
    folderIds.length ? Folder.find({ _id: { $in: folderIds } }).lean() : [],
  ]);
  const clipMap = new Map(clipsById.map((c) => [c._id.toString(), c]));
  const folderMap = new Map(foldersById.map((f) => [f._id.toString(), f]));

  const streamIdsToLoad = [
    ...new Set(mergedIds.map((r) => r.streamId).filter(Boolean)),
  ];
  const { streamMap, getMatchPayload } =
    await loadStreamsAndMeta(streamIdsToLoad);

  const items = mergedIds
    .map((row) => {
      if (row.itemType === "clip") {
        const clip = clipMap.get(row._id.toString());
        if (!clip) return null;
        const stream = streamMap.get(clip.streamId);
        return toMediaItemFromClip(clip, stream, getMatchPayload(stream));
      }
      const folder = folderMap.get(row._id.toString());
      if (!folder) return null;
      const stream = streamMap.get(folder.streamId);
      return toMediaItemFromFolder(folder, stream, getMatchPayload(stream));
    })
    .filter(Boolean);

  return { items, total };
}

/**
 * GET /api/media-library/stats
 * Aggregated stats for Media Library (total items, duration, avg rating, processing count, tab counts).
 * Cached briefly to improve load speed when dashboard/media library open repeatedly.
 */
export const getMediaLibraryStats = async (req, res) => {
  try {
    const orgId = await getCurrentUserOrgId(req);
    const { organizationId, streamIds, userId: queryUserId } = req.query;
    const effectiveOrgId = organizationId
      ? new mongoose.Types.ObjectId(organizationId)
      : orgId;
    const streamIdsArr = streamIds
      ? typeof streamIds === "string"
        ? streamIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      : null;

    const cacheKey = `stats:${String(effectiveOrgId || "")}:${(streamIdsArr || []).join(",")}:${queryUserId || ""}`;
    const cached = getCachedResponse(cacheKey);
    if (cached) return res.json(cached);

    // Exclude soft-deleted clips and highlights from counts/totals
    const includeDeleted =
      shouldIncludeDeleted(req) && req.user?.role === "superadmin";
    const clipMatch = includeDeleted ? {} : { isDeleted: { $ne: true } };
    const folderMatch = includeDeleted
      ? { type: "highlight" }
      : { type: "highlight", isDeleted: { $ne: true }, status: { $ne: "deleted" } };
    if (effectiveOrgId) {
      clipMatch.organization = effectiveOrgId;
      folderMatch.organization = effectiveOrgId;
    } else if (req.user?.userId) {
      clipMatch.userId = req.user.userId;
      folderMatch.userId = req.user.userId;
    } else {
      return res.status(400).json({
        success: false,
        error: "Organization or user context required",
      });
    }
    const existingStreamIds = await getExistingStreamIdsForScope(
      effectiveOrgId,
      req.user?.userId,
      queryUserId,
      streamIdsArr,
    );
    clipMatch.streamId = { $in: existingStreamIds };
    folderMatch.streamId = { $in: existingStreamIds };
    if (queryUserId) {
      clipMatch.userId = queryUserId;
      folderMatch.userId = queryUserId;
    }

    const streamMatch = { organization: effectiveOrgId };
    if (streamIdsArr?.length) streamMatch.streamId = { $in: streamIdsArr };

    const streamMediaClipMatch = {
      ...clipMatch,
      streamId: { $exists: true, $nin: [null, ""] },
    };
    const streamMediaFolderMatch = {
      ...folderMatch,
      streamId: { $exists: true, $nin: [null, ""] },
    };

    // One aggregate gives clip count + duration/rating/processing; avoid redundant Clip.countDocuments(clipMatch)
    const [
      clipStats,
      folderCount,
      streamCount,
      clipStreamCount,
      folderStreamCount,
    ] = await Promise.all([
      Clip.aggregate([
        { $match: clipMatch },
        {
          $group: {
            _id: null,
            totalDuration: { $sum: "$duration" },
            avgRating: { $avg: "$rating" },
            processingCount: {
              $sum: { $cond: [{ $eq: ["$clipStatus", "PROCESSING"] }, 1, 0] },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Folder.countDocuments(folderMatch),
      Stream.countDocuments(streamMatch),
      Clip.countDocuments(streamMediaClipMatch),
      Folder.countDocuments(streamMediaFolderMatch),
    ]);

    const c = clipStats[0] || {
      totalDuration: 0,
      avgRating: 0,
      processingCount: 0,
      count: 0,
    };
    const totalItems = c.count + folderCount;
    const totalDurationSec = c.totalDuration || 0;
    const avgRating =
      c.avgRating != null ? Math.round(c.avgRating * 10) / 10 : 0;
    const processingCount = c.processingCount || 0;
    const countStreamMedia = clipStreamCount + folderStreamCount;

    const response = {
      success: true,
      data: {
        totalItems,
        totalDuration: totalDurationSec,
        totalDurationLabel: durationToLabel(totalDurationSec),
        avgRating,
        processingCount,
        countClips: c.count,
        countHighlights: folderCount,
        countStreams: streamCount,
        countStreamMedia,
      },
    };
    setCachedResponse(cacheKey, response);
    return res.json(response);
  } catch (error) {
    logger.error("getMediaLibraryStats error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

/**
 * GET /api/media-library/filters/counts
 * Dynamic filter counts for tags, ratings, aspect ratios, categories, status.
 */
export const getMediaLibraryFilterCounts = async (req, res) => {
  try {
    const orgId = await getCurrentUserOrgId(req);
    const {
      organizationId,
      streamIds,
      userId: queryUserId,
      mediaType,
      streamsOnly,
    } = req.query;
    const effectiveOrgId = organizationId
      ? new mongoose.Types.ObjectId(organizationId)
      : orgId;
    const streamIdsArr = toStringArray(streamIds);
    const cacheKey = `counts:${String(effectiveOrgId || req.user?.userId || "")}:${JSON.stringify(req.query)}`;
    const cached = getCachedResponse(cacheKey);
    if (cached) return res.json(cached);

    const scope = buildScopeMatch({
      effectiveOrgId,
      reqUserId: req.user?.userId,
      queryUserId,
      streamIdsArr,
      streamsOnly,
      includeDeleted:
        shouldIncludeDeleted(req) && req.user?.role === "superadmin",
    });
    if (scope.error) {
      return res.status(400).json({ success: false, error: scope.error });
    }

    const filters = buildFilterState(req.query);
    const { allowedStreamIds: rawAllowedStreamIds, searchStreamIds, streamScopeMatch } =
      await resolveStreamContext({
        effectiveOrgId,
        reqUserId: req.user?.userId,
        queryUserId,
        streamIdsArr,
        filters,
      });
    const existingStreamIds = await getExistingStreamIdsForScope(
      effectiveOrgId,
      req.user?.userId,
      queryUserId,
      streamIdsArr,
    );
    const allowedStreamIds =
      rawAllowedStreamIds?.length
        ? rawAllowedStreamIds.filter((id) => existingStreamIds.includes(id))
        : existingStreamIds;

    // For Sport dropdown and League/Event dimensions: resolve all 7 scopes in parallel (one round-trip).
    const filtersNoCategory = { ...filters, categoryValues: [] };
    const LEAGUE_EVENT_DIMENSIONS = [
      "competition",
      "season",
      "matchDay",
      "matchDate",
      "matches",
      "teams",
      "venues",
    ];
    const [resolvedNoCategory, ...resolvedScopes] = await Promise.all([
      resolveStreamContext({
        effectiveOrgId,
        reqUserId: req.user?.userId,
        queryUserId,
        streamIdsArr,
        filters: filtersNoCategory,
      }),
      ...LEAGUE_EVENT_DIMENSIONS.map((dim) =>
        resolveStreamContext({
          effectiveOrgId,
          reqUserId: req.user?.userId,
          queryUserId,
          streamIdsArr,
          filters: filtersForLeagueEventDimension(filters, dim),
        }),
      ),
    ]);
    const allowedStreamIdsNoCategory =
      resolvedNoCategory?.allowedStreamIds?.length
        ? resolvedNoCategory.allowedStreamIds.filter((id) => existingStreamIds.includes(id))
        : existingStreamIds;
    // Run 6 Stream.find in parallel with clip/folder aggregates below (saves ~1 round-trip).
    const matchIdsByDimensionP = Promise.all(
      resolvedScopes.map((scope) => {
        const streamIds = scope.allowedStreamIds;
        const query =
          streamIds == null
            ? streamScopeMatch
            : { ...streamScopeMatch, streamId: { $in: streamIds } };
        return Stream.find(query)
          .select("matchId")
          .lean()
          .then((docs) =>
            [...new Set(docs.map((d) => d.matchId).filter(Boolean))]
              .map((id) => String(id).trim())
              .filter(Boolean),
          );
      }),
    );

    const clipMatch = { ...scope.clipMatch };
    const folderMatch = { ...scope.folderMatch };
    if (mediaType === "clip") folderMatch._id = { $in: [] };
    if (mediaType === "highlight") clipMatch._id = { $in: [] };
    applyDatabaseFilterState({
      clipMatch,
      folderMatch,
      filters,
      allowedStreamIds,
      searchStreamIds,
    });

    const clipsOnly = mediaType === "clip";
    const highlightsOnly = mediaType === "highlight";

    // Sport dropdown: count by category with no filters (so all sports show with DB-level counts).
    const categoryOnlyClipMatch = { ...scope.clipMatch, streamId: { $in: allowedStreamIdsNoCategory || [] } };
    const categoryOnlyFolderMatch = { ...scope.folderMatch, streamId: { $in: allowedStreamIdsNoCategory || [] } };
    if (clipsOnly) categoryOnlyFolderMatch._id = { $in: [] };
    if (highlightsOnly) categoryOnlyClipMatch._id = { $in: [] };

    // Tag lookup: resolve tagType from tags collection. Do NOT default missing tags to 'event'
    // so that only tags that exist in Tag with tagType event/player are counted (matches clip section).
    const tagLookup = [
      {
        $lookup: {
          from: "tags",
          let: { tagName: "$tag" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toLower: "$name" }, { $toLower: "$$tagName" }],
                },
              },
            },
            { $project: { tagType: 1 } },
            { $limit: 1 },
          ],
          as: "meta",
        },
      },
      {
        $addFields: {
          tagType: { $arrayElemAt: ["$meta.tagType", 0] },
        },
      },
    ];

    const categoryOnlyStreamIds = allowedStreamIdsNoCategory || [];
    // Single Clip $facet: one collection scan instead of ~10 separate aggregates (big speed win).
    const clipFacetPipeline = {
      tagCounts: [
        { $project: { tags: { $ifNull: ["$tags", []] } } },
        { $unwind: "$tags" },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
        { $project: { label: "$_id", count: 1, _id: 0 } },
      ],
      ratingCounts: [
        { $match: { rating: { $ne: null } } },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
        { $project: { rating: "$_id", count: 1, _id: 0 } },
      ],
      aspectCounts: [
        { $group: { _id: "$aspectRatio", count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ""] } } },
        { $project: { aspectRatio: "$_id", count: 1, _id: 0 } },
      ],
      categoryCounts: [
        { $match: { streamId: { $in: categoryOnlyStreamIds } } },
        { $group: { _id: { $ifNull: ["$customData.sportName", ""] }, count: { $sum: 1 } } },
        { $match: { _id: { $ne: "" } } },
        { $project: { category: "$_id", count: 1, _id: 0 } },
      ],
      statusCounts: [
        { $group: { _id: { $ifNull: ["$clipStatus", "COMPLETED"] }, count: { $sum: 1 } } },
        { $project: { status: "$_id", count: 1, _id: 0 } },
      ],
      platformCounts: [
        { $unwind: "$clipPublished" },
        { $match: { "clipPublished.platform": { $nin: [null, ""] } } },
        { $group: { _id: "$clipPublished.platform", count: { $sum: 1 } } },
        { $project: { platform: "$_id", count: 1, _id: 0 } },
      ],
      playerFromTags: [
        { $project: { tags: { $ifNull: ["$tags", []] } } },
        { $unwind: "$tags" },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
        { $project: { tag: "$_id", count: 1, _id: 0 } },
        ...tagLookup,
        { $match: { tagType: "player" } },
        { $project: { player: "$tag", count: 1, _id: 0 } },
      ],
      playerFromCustomData: [
        { $project: { players: { $ifNull: ["$customData.players", []] } } },
        { $unwind: "$players" },
        { $group: { _id: "$players", count: { $sum: 1 } } },
        { $project: { player: "$_id", count: 1, _id: 0 } },
      ],
      actionCounts: [
        { $project: { tags: { $ifNull: ["$tags", []] } } },
        { $unwind: "$tags" },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
        { $project: { tag: "$_id", count: 1, _id: 0 } },
        ...tagLookup,
        { $match: { tagType: "event" } },
        { $project: { action: "$tag", count: 1, _id: 0 } },
      ],
      sourceCounts: [
        {
          $group: {
            _id: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$isAiCreated", true] },
                    { $eq: ["$isManual", false] },
                  ],
                },
                "AI",
                "Manual",
              ],
            },
            count: { $sum: 1 },
          },
        },
        { $project: { source: "$_id", count: 1, _id: 0 } },
      ],
    };
    const emptyArr = () => Promise.resolve([]);
    const emptyFacetResult = [
      [], [], [], [], [], [], [], [], [], [],
    ];
    const clipFacetP = highlightsOnly
      ? Promise.resolve(emptyFacetResult)
      : Clip.aggregate([
          { $match: clipMatch },
          { $facet: clipFacetPipeline },
        ]).then((res) => {
          const r = res[0] || {};
          return [
            r.tagCounts || [],
            r.ratingCounts || [],
            r.aspectCounts || [],
            r.categoryCounts || [],
            r.statusCounts || [],
            r.platformCounts || [],
            r.playerFromTags || [],
            r.playerFromCustomData || [],
            r.actionCounts || [],
            r.sourceCounts || [],
          ];
        });
    const folderTagP = clipsOnly
      ? emptyArr()
      : Folder.aggregate([
          { $match: folderMatch },
          { $project: { tags: { $ifNull: ["$tags", []] } } },
          { $unwind: "$tags" },
          { $group: { _id: "$tags", count: { $sum: 1 } } },
          { $project: { label: "$_id", count: 1, _id: 0 } },
        ]);
    const folderEventTagP = clipsOnly
      ? emptyArr()
      : Folder.aggregate([
          { $match: folderMatch },
          { $project: { tags: { $ifNull: ["$tags", []] } } },
          { $unwind: "$tags" },
          { $group: { _id: "$tags", count: { $sum: 1 } } },
          { $project: { tag: "$_id", count: 1, _id: 0 } },
          ...tagLookup,
          { $match: { tagType: "event" } },
          { $project: { action: "$tag", count: 1, _id: 0 } },
        ]);
    const folderRatingP = clipsOnly
      ? emptyArr()
      : Folder.aggregate([
          { $match: folderMatch },
          { $match: { rating: { $ne: null } } },
          { $group: { _id: "$rating", count: { $sum: 1 } } },
          { $project: { rating: "$_id", count: 1, _id: 0 } },
        ]);
    const folderAspectP = clipsOnly
      ? emptyArr()
      : Folder.aggregate([
          { $match: folderMatch },
          { $group: { _id: "$aspectRatio", count: { $sum: 1 } } },
          { $match: { _id: { $nin: [null, ""] } } },
          { $project: { aspectRatio: "$_id", count: 1, _id: 0 } },
        ]);
    const folderCategoryP = clipsOnly
      ? emptyArr()
      : Folder.aggregate([
          { $match: categoryOnlyFolderMatch },
          { $group: { _id: { $ifNull: ["$category", ""] }, count: { $sum: 1 } } },
          { $match: { _id: { $ne: "" } } },
          { $project: { category: "$_id", count: 1, _id: 0 } },
        ]);
    const matchedClipStreamIdsP = highlightsOnly
      ? Promise.resolve([])
      : Clip.distinct("streamId", clipMatch);
    const matchedFolderStreamIdsP = clipsOnly
      ? Promise.resolve([])
      : Folder.distinct("streamId", folderMatch);
    const folderSourceP = clipsOnly
      ? emptyArr()
      : Folder.aggregate([
          { $match: folderMatch },
          {
            $group: {
              _id: { $cond: [{ $eq: ["$isAiCreated", true] }, "AI", "Manual"] },
              count: { $sum: 1 },
            },
          },
          { $project: { source: "$_id", count: 1, _id: 0 } },
        ]);

    // Run Stream dimension lookups in parallel with clip/folder aggregates.
    const [
      matchIdsByDimension,
      clipFacetResult,
      folderTagCounts,
      folderEventTagCounts,
      folderRatingCounts,
      folderAspectCounts,
      folderCategoryCounts,
      matchedClipStreamIds,
      matchedFolderStreamIds,
      folderSourceCountsRaw,
    ] = await Promise.all([
      matchIdsByDimensionP,
      clipFacetP,
      folderTagP,
      folderEventTagP,
      folderRatingP,
      folderAspectP,
      folderCategoryP,
      matchedClipStreamIdsP,
      matchedFolderStreamIdsP,
      folderSourceP,
    ]);

    const [
      matchIdsStrCompetition,
      matchIdsStrSeason,
      matchIdsStrMatchDay,
      matchIdsStrMatchDate,
      matchIdsStrMatches,
      matchIdsStrTeams,
      matchIdsStrVenues,
    ] = matchIdsByDimension;

    const [
      clipTagCounts,
      clipRatingCounts,
      clipAspectCounts,
      clipCategoryCounts,
      clipStatusCounts,
      clipPlatformCounts,
      clipPlayerFromTagsCounts,
      clipPlayerFromCustomDataCounts,
      clipActionCounts,
      clipSourceCountsRaw,
    ] = clipFacetResult;

    const matchedStreamIds = [
      ...new Set(
        [...matchedClipStreamIds, ...matchedFolderStreamIds].filter(Boolean),
      ),
    ];
    const streamMatch = { ...streamScopeMatch };
    if (matchedStreamIds.length)
      streamMatch.streamId = { $in: matchedStreamIds };
    else if (allowedStreamIds && allowedStreamIds.length === 0)
      streamMatch.streamId = { $in: [] };

    // Always load ALL org streams' matchIds so filter dropdowns are fully populated
    const allOrgStreamMatch = { ...streamScopeMatch };
    if (filters.categoryValues.length) {
      const categoryMatchValues = expandCategoryValues(filters.categoryValues);
      allOrgStreamMatch.category = {
        $in: exactRegexList(categoryMatchValues),
      };
    }
    const [matchedStreams, allOrgStreams] = await Promise.all([
      matchedStreamIds.length
        ? Stream.find(streamMatch)
            .select("streamId matchId organization category")
            .lean()
        : [],
      effectiveOrgId
        ? Stream.find(allOrgStreamMatch).select("matchId streamId").lean()
        : [],
    ]);
    const clipChainMatchIds = matchedStreams
      .map((stream) => stream.matchId)
      .filter(Boolean);
    const allOrgMatchIds = allOrgStreams.map((s) => s.matchId).filter(Boolean);

    // Hierarchical: when filters narrow the clips/streams, use only those matchIds
    // so downstream filter dropdowns reflect the parent selection.
    // When no filters are active (initial load), use all org matchIds so every dropdown is populated.
    const hasActiveFilters = allowedStreamIds !== null;
    const matchedMatchIds =
      hasActiveFilters && clipChainMatchIds.length
        ? [...new Set(clipChainMatchIds)]
        : [...new Set([...clipChainMatchIds, ...allOrgMatchIds])];

    const matchIdsStr = matchedMatchIds
      .map((id) => String(id).trim())
      .filter(Boolean);

    logger.info(
      `[FilterCounts] org=${effectiveOrgId || "none"} | ` +
        `matchedStreamIds=${matchedStreamIds.length} | ` +
        `clipChainMatchIds=${clipChainMatchIds.length} | ` +
        `allOrgStreams=${allOrgStreams.length} | ` +
        `allOrgMatchIds=${new Set(allOrgMatchIds).size} | ` +
        `hasActiveFilters=${hasActiveFilters} | ` +
        `finalMatchIds=${matchIdsStr.length}`,
    );

    const matchMetaMatch = {};
    if (matchIdsStr.length) {
      matchMetaMatch.matchId = { $in: matchIdsStr };
    } else if (effectiveOrgId) {
      matchMetaMatch.organization = effectiveOrgId;
    }
    const hasMatchMetadataScope = matchIdsStr.length > 0 || !!effectiveOrgId;

    // Per-dimension match scope for hierarchical League & Event dropdowns.
    const matchMetaFor = (ids) =>
      ids.length > 0 ? { matchId: { $in: ids } } : { matchId: { $in: [] } };

    logger.info(
      `[FilterCounts] matchMetaMatch=${JSON.stringify(
        matchIdsStr.length
          ? { matchId: { $in: `[${matchIdsStr.length} ids]` } }
          : effectiveOrgId
            ? { organization: String(effectiveOrgId) }
            : {},
      )} | hasScope=${hasMatchMetadataScope} | hierarchyScopes=8`,
    );

    backfillMatchMetadataForMatchIds({
      matchIdsStr,
      matchedStreams,
      effectiveOrgId,
    });
    repairMatchMetadataOrg({ matchIdsStr, effectiveOrgId });

    const folderCountP = clipsOnly
      ? Promise.resolve(0)
      : Folder.countDocuments(folderMatch);

    const streamCategoryCountsP =
      streamScopeMatch && Object.keys(streamScopeMatch).length > 0
        ? Stream.aggregate([
            { $match: streamScopeMatch },
            {
              $group: {
                _id: { $ifNull: ["$category", ""] },
                count: { $sum: 1 },
              },
            },
            { $match: { _id: { $nin: [null, ""] } } },
            { $project: { category: "$_id", count: 1, _id: 0 } },
          ])
        : Promise.resolve([]);

    const [
      streamCounts,
      seasonCounts,
      competitionCounts,
      matchDayCounts,
      teamCounts,
      venueCounts,
      matchCounts,
      matchDateCounts,
      streamCategoryCounts,
      folderCount,
    ] = await Promise.all([
      matchedStreamIds.length
        ? Stream.aggregate([
            { $match: streamMatch },
            { $group: { _id: "$title", count: { $sum: 1 } } },
            { $match: { _id: { $nin: [null, ""] } } },
            { $project: { stream: "$_id", count: 1, _id: 0 } },
          ])
        : [],
      MatchMetadata.aggregate([
        { $match: matchMetaFor(matchIdsStrSeason) },
        {
          $group: {
            _id: { $ifNull: ["$payload.season", ""] },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
        { $project: { season: "$_id", count: 1, _id: 0 } },
      ]),
      MatchMetadata.aggregate([
        { $match: matchMetaFor(matchIdsStrCompetition) },
        {
          $group: {
            _id: { $ifNull: ["$payload.competition", ""] },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
        { $project: { competition: "$_id", count: 1, _id: 0 } },
      ]),
      MatchMetadata.aggregate([
        { $match: matchMetaFor(matchIdsStrMatchDay) },
        {
          $group: {
            _id: { $ifNull: ["$payload.matchDay", "$payload.session", ""] },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
        { $project: { matchDay: "$_id", count: 1, _id: 0 } },
      ]),
      MatchMetadata.aggregate([
        { $match: matchMetaFor(matchIdsStrTeams) },
        { $unwind: "$payload.teams" },
        { $match: { "payload.teams": { $ne: "" } } },
        { $group: { _id: "$payload.teams", count: { $sum: 1 } } },
        { $project: { team: "$_id", count: 1, _id: 0 } },
      ]),
      MatchMetadata.aggregate([
        { $match: matchMetaFor(matchIdsStrVenues) },
        {
          $group: {
            _id: { $ifNull: ["$payload.venue", ""] },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
        { $project: { venue: "$_id", count: 1, _id: 0 } },
      ]),
      MatchMetadata.aggregate([
        { $match: matchMetaFor(matchIdsStrMatches) },
        {
          $group: {
            _id: {
              matchName: { $ifNull: ["$payload.matchName", ""] },
              matchDate: { $ifNull: ["$payload.matchDate", ""] },
            },
            count: { $sum: 1 },
          },
        },
        { $match: { "_id.matchName": { $nin: [null, ""] } } },
        {
          $project: {
            matchName: "$_id.matchName",
            matchDate: "$_id.matchDate",
            count: 1,
            _id: 0,
          },
        },
      ]),
      MatchMetadata.aggregate([
        { $match: matchMetaFor(matchIdsStrMatchDate) },
        {
          $group: {
            _id: { $ifNull: ["$payload.matchDate", ""] },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
        { $project: { matchDate: "$_id", count: 1, _id: 0 } },
      ]),
      streamCategoryCountsP,
      folderCountP,
    ]);

    logger.info(
      `[FilterCounts] results | ` +
        `seasons=${seasonCounts.length} | ` +
        `competitions=${competitionCounts.length} | ` +
        `matchDays=${matchDayCounts.length} | ` +
        `teams=${teamCounts.length} | ` +
        `venues=${venueCounts.length} | ` +
        `matches=${matchCounts.length} | ` +
        `matchDates=${matchDateCounts.length} | ` +
        `streams=${streamCounts.length}`,
    );

    const readyFolderCount = folderCount;
    const completedFolderCount = folderCount;
    const sourceCounts = mergeCountRecords(
      [clipSourceCountsRaw, folderSourceCountsRaw],
      "source",
    );
    const tagCounts = mergeCountRecords(
      [clipTagCounts, folderTagCounts],
      "label",
    );
    const aspectCounts = mergeCountRecords(
      [clipAspectCounts, folderAspectCounts],
      "aspectRatio",
    );
    const categoryCounts = mergeCountRecords(
      [clipCategoryCounts, folderCategoryCounts, streamCategoryCounts],
      "category",
    );
    const ratingCountMap = new Map();
    [...clipRatingCounts, ...folderRatingCounts].forEach((entry) => {
      const rating = Number(entry.rating);
      if (Number.isNaN(rating)) return;
      ratingCountMap.set(
        rating,
        (ratingCountMap.get(rating) || 0) + Number(entry.count || 0),
      );
    });
    const ratingCountsRaw = [...ratingCountMap.entries()]
      .map(([rating, count]) => ({ rating, count }))
      .sort((a, b) => b.rating - a.rating);
    const clipStatusesMerged = mergeCountRecords(
      [
        clipStatusCounts,
        completedFolderCount
          ? [{ status: "COMPLETED", count: completedFolderCount }]
          : [],
      ],
      "status",
    );
    const downloadStatusesMerged = mergeCountRecords(
      [
        clipStatusCounts.map((entry) => ({
          status: clipStatusToDownloadStatus(entry.status),
          count: entry.count,
        })),
        readyFolderCount ? [{ status: "Ready", count: readyFolderCount }] : [],
      ],
      "status",
    );

    // Only send options with count > 0 for every filter dropdown.
    const onlyCountGt0 = (arr) => (Array.isArray(arr) ? arr.filter((e) => Number(e.count) > 0) : []);
    const ratingCounts = onlyCountGt0(ratingCountsRaw);
    const platformCounts = clipPlatformCounts;
    const playerCountsMerged = mergeCountRecords(
      [clipPlayerFromTagsCounts, clipPlayerFromCustomDataCounts],
      "player",
    );
    const actionCountsMerged = mergeCountRecords(
      [clipActionCounts, folderEventTagCounts],
      "action",
    );

    // Actions and players: same values as GET /api/tags?category=…&tagType=event|player (tag documents + count), in same keys, no extra API.
    const tagBaseQuery = effectiveOrgId
      ? { organization: effectiveOrgId }
      : req.user?.userId
        ? { createdBy: String(req.user.userId) }
        : null;
    let actionsForResponse = []; // only ever filled from Tag (event list); never send raw aggregation
    let playersForResponse = playerCountsMerged;
    if (tagBaseQuery) {
      const categoriesForTags =
        filters.categoryValues?.length > 0
          ? expandCategoryValues(filters.categoryValues)
          : await Tag.distinct("category", tagBaseQuery);
      const actionCountByKey = new Map(
        actionCountsMerged.map((e) => [
          String(e.action || "")
            .trim()
            .toLowerCase(),
          e.count,
        ]),
      );
      const playerCountByKey = new Map(
        playerCountsMerged.map((e) => [
          String(e.player || "")
            .trim()
            .toLowerCase(),
          e.count,
        ]),
      );
      // Same query shape as GET /api/tags?category=…&tagType=event|player (no streamId; global). No limit.
      const [eventTagDocs, playerTagDocs] = await Promise.all([
        categoriesForTags.length
          ? Tag.find({
              ...tagBaseQuery,
              category: { $in: categoriesForTags },
              tagType: "event",
            })
              .sort({ name: 1 })
              .lean()
          : [],
        categoriesForTags.length
          ? Tag.find({
              ...tagBaseQuery,
              category: { $in: categoriesForTags },
              tagType: "player",
            })
              .sort({ name: 1 })
              .lean()
          : [],
      ]);
      // Actions: only events that exist in Settings → Events (Tag collection, tagType event). Never send anything else.
      actionsForResponse = (eventTagDocs || []).map((t) => {
        const name = (t.name || "").trim();
        const count = actionCountByKey.get(name.toLowerCase()) ?? 0;
        return { ...t, action: name, count };
      });
      // Players: only include options with count > 0.
      const playersWithCount = (playerTagDocs || []).map((t) => {
        const name = (t.name || t.metaData?.playerName || "").trim();
        const count = playerCountByKey.get(name.toLowerCase()) ?? 0;
        return { ...t, player: name, count };
      });
      const allPlayers = (playerTagDocs || []).length > 0 ? playersWithCount : playerCountsMerged;
      playersForResponse = onlyCountGt0(allPlayers);
      actionsForResponse = onlyCountGt0(actionsForResponse);
    } else {
      playersForResponse = onlyCountGt0(playerCountsMerged);
    }

    // Single count API: only options with count > 0. Counts are DB-level (frontend does not send filter selections).
    const response = {
      success: true,
      data: {
        tags: onlyCountGt0(tagCounts),
        ratings: ratingCounts,
        aspectRatios: onlyCountGt0(aspectCounts),
        categories: onlyCountGt0(categoryCounts),
        statuses: onlyCountGt0(downloadStatusesMerged),
        clipStatuses: onlyCountGt0(clipStatusesMerged),
        downloadStatuses: onlyCountGt0(downloadStatusesMerged),
        platforms: onlyCountGt0(platformCounts),
        sources: onlyCountGt0(sourceCounts),
        players: playersForResponse,
        actions: actionsForResponse,
        streams: onlyCountGt0(streamCounts),
        seasons: onlyCountGt0(seasonCounts),
        competitions: onlyCountGt0(competitionCounts),
        matchDays: onlyCountGt0(matchDayCounts),
        teams: onlyCountGt0(teamCounts),
        venues: onlyCountGt0(venueCounts),
        matches: onlyCountGt0(matchCounts),
        matchDates: onlyCountGt0(matchDateCounts),
      },
    };
    setCachedResponse(cacheKey, response, 120000); // 2 min cache for filter counts (heavy query; avoids ~6s on repeat loads)
    return res.json(response);
  } catch (error) {
    logger.error("getMediaLibraryFilterCounts error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

/**
 * POST /api/media-library/backfill-match-metadata
 * Backfill MatchMetadata for existing streams that have matchId but no cached metadata.
 * Optional query/body: limit (default 50), organizationId, refreshIncomplete (default false).
 */
export const backfillMatchMetadata = async (req, res) => {
  try {
    const orgId = await getCurrentUserOrgId(req);
    const organizationId = req.query.organizationId || req.body?.organizationId;
    const refreshIncomplete =
      String(
        req.query.refreshIncomplete ?? req.body?.refreshIncomplete ?? "false",
      ).toLowerCase() === "true";
    const effectiveOrgId = organizationId
      ? new mongoose.Types.ObjectId(organizationId)
      : orgId;
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || req.body?.limit || "50", 10)),
    );

    if (!effectiveOrgId) {
      return res
        .status(400)
        .json({ success: false, error: "Organization context required" });
    }

    const streamsWithMatch = await Stream.find({
      organization: effectiveOrgId,
      matchId: { $exists: true, $nin: [null, ""] },
    })
      .select("streamId matchId organization category")
      .limit(limit * 2)
      .lean();

    const matchIds = [
      ...new Set(
        streamsWithMatch.map((s) => String(s.matchId).trim()).filter(Boolean),
      ),
    ];
    if (!matchIds.length) {
      return res.json({
        success: true,
        message: "No streams with matchId found",
        data: { backfilled: 0, skipped: 0 },
      });
    }

    const existing = await MatchMetadata.find({ matchId: { $in: matchIds } })
      .select("matchId payload")
      .lean();
    const existingMap = new Map(
      existing.map((doc) => [String(doc.matchId).trim(), doc]),
    );
    const missing = matchIds.filter((id) => !existingMap.has(id));
    const incomplete = refreshIncomplete
      ? matchIds.filter((id) => {
          const doc = existingMap.get(id);
          return doc ? isMatchMetadataIncomplete(doc) : false;
        })
      : [];
    const targetMatchIds = [...new Set([...missing, ...incomplete])].slice(
      0,
      limit,
    );

    const streamByMatchId = new Map();
    streamsWithMatch.forEach((s) => {
      const mid = String(s.matchId).trim();
      if (!streamByMatchId.has(mid))
        streamByMatchId.set(mid, {
          streamId: s.streamId || "",
          organization: s.organization,
          category:
            (s.category || "others") === "football"
              ? "soccer"
              : s.category || "others",
        });
    });

    let backfilled = 0;
    let refreshed = 0;
    await Promise.all(
      targetMatchIds.map((matchId) => {
        const ctx = streamByMatchId.get(matchId) || {};
        const category = ctx.category || "soccer";
        const wasExisting = existingMap.has(matchId);
        return fetchAndParseMatchMetadata(matchId, category)
          .then((payload) =>
            MatchMetadata.findOneAndUpdate(
              { matchId },
              {
                $set: {
                  streamId: ctx.streamId || "",
                  organization: ctx.organization || effectiveOrgId || null,
                  category: ctx.category || "",
                  payload,
                  updatedAt: new Date(),
                },
              },
              { upsert: true, new: true },
            ),
          )
          .then(() => {
            if (wasExisting) refreshed += 1;
            else backfilled += 1;
          })
          .catch((err) => {
            logger.warn(
              "Backfill failed for matchId",
              matchId,
              err?.message || err,
            );
          });
      }),
    );

    return res.json({
      success: true,
      message: refreshIncomplete
        ? `Backfilled ${backfilled} and refreshed ${refreshed} match metadata entries`
        : `Backfilled ${backfilled} match metadata entries`,
      data: {
        backfilled,
        refreshed,
        refreshIncomplete,
        candidates: targetMatchIds.length,
        skipped: targetMatchIds.length - (backfilled + refreshed),
      },
    });
  } catch (error) {
    logger.error("backfillMatchMetadata error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};
