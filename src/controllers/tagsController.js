import Tag from '../models/Tag.js';
import { validationResult } from 'express-validator';
import axios from 'axios';
import logger from '../utils/logger.js';
import Team from '../models/Team.js';
import shortid from 'shortid';
import { getCurrentUserOrgId } from '../utils/organizationHelper.js';
import { activeFilter } from '../utils/softDelete.js';
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

// Get all tags by category and type
const getTagsByCategoryAndType = async (req, res) => {
  try {
    const { category, tagType, streamId, organizationId } = req.query;
    const userId = req.user?.userId || req.query.userId || req.body?.userId;
    const rawPlayerIds = req.query.playerIds;
    const limit = Math.max(1, Number(req.query.limit || (tagType === 'player' && rawPlayerIds ? 100 : undefined) || 20));
    const pageNo = Math.max(1, Number(req.query.pageNo || 1));
    const search = String(req.query.search || '').trim();
    
    if (!category || !tagType) {
      return res.status(400).json({
        success: false,
        message: 'Category and tagType are required'
      });
    }
    const orgIdForUser = await getCurrentUserOrgId(req);
    const query = { category, tagType, ...activeFilter(req) };
    const and = [];
    if (organizationId) {
      and.push({ organization: organizationId });
    } else if (orgIdForUser) {
      const or = [{ organization: orgIdForUser }];
      if (userId) {
        or.push({ createdBy: String(userId) });
      }
      and.push({ $or: or });
    } else if (userId) {
      and.push({ createdBy: String(userId) });
    } else {
      return res.status(400).json({
        success: false,
        message: 'userId is required when not in an organization'
      });
    }
    // If a streamId is provided, filter by it; otherwise return tags across streams
    if (streamId) {
      query.streamId = streamId;
    }

    // Filter by playerIds when provided (only for player tagType)
    if (tagType === 'player' && rawPlayerIds) {
      try {
        const parsed = typeof rawPlayerIds === 'string'
          ? (rawPlayerIds.startsWith('[') ? JSON.parse(rawPlayerIds) : String(rawPlayerIds).split(','))
          : rawPlayerIds;
        const arr = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
        if (arr.length > 0) {
          query._id = { $in: arr };
        }
      } catch {
        // ignore
      }
    }

    const skip = (pageNo - 1) * limit;
    // Apply search filter
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      if (tagType === 'player') {
        and.push({ $or: [{ name: regex }, { 'metaData.playerName': regex }] });
      } else {
        and.push({ name: regex });
      }
    }
    if (and.length > 0) {
      query.$and = and;
    }
    const [tags, total] = await Promise.all([
      Tag.find(query)
        .populate('creator', 'name email userId')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Tag.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: tags,
      count: tags.length,
      total,
      pageNo,
      limit
    });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Create a new tag
const createTag = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { category, name, tagType, userId, metaData } = req.body;
    const authUserId = req.user?.userId || userId;

    if (!authUserId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({
        success: false,
        message: 'Tag name is required'
      });
    }

    // Pre-check duplicates scoped to user
    if (tagType === 'event') {
      const existingEvent = await Tag.findOne({
        category,
        name: trimmedName,
        tagType,
        createdBy: String(authUserId)
      }).lean();
      if (existingEvent) {
        return res.status(409).json({
          success: false,
          message: 'Event tag already exists for this user and category'
        });
      }
    } else if (tagType === 'player') {
      const peopleId = String(metaData?.peopleId || '').trim();
      if (peopleId) {
        const existingPlayer = await Tag.findOne({
          createdBy: String(authUserId),
          category,
          tagType: 'player',
          'metaData.peopleId': peopleId
        }).lean();
        if (existingPlayer) {
          return res.status(409).json({
            success: false,
            message: 'Player already exists for this category'
          });
        }
      } else {
        const existingByName = await Tag.findOne({
          createdBy: String(authUserId),
          category,
          tagType: 'player',
          name: trimmedName
        }).lean();
        if (existingByName) {
          return res.json({
            success: false,
            message: 'Player with this name already exists for this category'
          });
        }
      }
    }

    const organizationId = await getCurrentUserOrgId(req);
    const tagData = {
      category,
      name: trimmedName,
      tagType,
      createdBy: String(authUserId),
      ...(organizationId && { organization: organizationId }),
    };

    // Add streamId and metaData for player tags
    // if (tagType === 'player') {
      // if (!streamId) {
      //   return res.status(400).json({
      //     success: false,
      //     message: 'StreamId is required for player tags'
      //   });
      // }
      // tagData.streamId = streamId;
      // tagData.metaData = {
      //   playerName: metaData?.playerName || name.trim(),
      //   jerseyNumber: metaData?.jerseyNumber || null
      // };
    // }

    const tag = new Tag(tagData);
    await tag.save();

    const populatedTag = await Tag.findById(tag._id)
      .populate('creator', 'name email userId')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Tag created successfully',
      data: populatedTag
    });
  } catch (error) {
    console.error('Error creating tag:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Tag with this name already exists in the specified category for this user'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update a tag
const updateTag = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { name, metaData } = req.body;

    const tag = await Tag.findOne({ _id: id, ...activeFilter(req) });
    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found'
      });
    }

    // Check if user has permission to update
    if (tag.createdBy.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this tag'
      });
    }

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (tag.tagType === 'player') {
      updateData.name = name.trim();
      // updateData.metaData = {
      //   playerName: metaData.playerName || tag.metaData.playerName,
      //   jerseyNumber: metaData.jerseyNumber !== undefined ? metaData.jerseyNumber : tag.metaData.jerseyNumber
      // };
    }

    const updatedTag = await Tag.findOneAndUpdate(
      { _id: id, ...activeFilter(req) },
      { ...updateData, ...getAuditStamp(req) },
      { new: true, runValidators: true }
    ).populate('creator', 'name email userId').lean();
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'update',
      entity: 'tag',
      entityId: updatedTag?._id?.toString?.(),
      orgId: updatedTag?.organization || null,
      metadata: { fields: Object.keys(updateData || {}) },
    });

    res.status(200).json({
      success: true,
      message: 'Tag updated successfully',
      data: updatedTag
    });
  } catch (error) {
    console.error('Error updating tag:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Tag with this name already exists in the specified category'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete a tag
const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;

    const tag = await Tag.findOne({ _id: id, ...activeFilter(req) });
    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found'
      });
    }

    // Check if user has permission to delete
    // if (tag.createdBy.toString() !== req.user.userId) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'You do not have permission to delete this tag'
    //   });
    // }

    await Tag.updateOne({ _id: id, ...activeFilter(req) }, { $set: getSoftDeleteStamp(req) });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'delete',
      entity: 'tag',
      entityId: tag?._id?.toString?.(),
      orgId: tag?.organization || null,
    });

    res.status(200).json({
      success: true,
      message: 'Tag deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Import players from DSG by team and season
const importPlayersFromDSG = async (req, res) => {
  try {
    const userId = req.user?.userId || req.body?.userId;
    const { teamId, seasonId, category: reqCategory } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
    if (!teamId) return res.status(400).json({ success: false, message: 'teamId is required' });
    if (!seasonId) return res.status(400).json({ success: false, message: 'seasonId is required' });
    const organizationId = await getCurrentUserOrgId(req);
    const season = String(seasonId);
    const tagCategory = String(reqCategory);
    const sportPath = String(reqCategory === "football" ? "soccer" : reqCategory);
    const base = process.env.DSG_API_BASE || 'https://dsg-api.com';
    const client = process.env.DSG_CLIENT || 'dataaistream';
    const authkey = process.env.DSG_AUTHKEY || '';
    const basicUser = client;
    const basicPass = process.env.DSG_BASIC_PASS || '';
    if (!authkey) {
      return res.status(500).json({ success: false, message: 'DSG_AUTHKEY is not configured' });
    }
    let teamDoc = await Team.findOne({ userId, team_id: String(teamId) });
    if (!teamDoc) {
      teamDoc = await Team.findOne({ userId, id: String(teamId) });
    }
    const extTeamId = String(teamDoc?.team_id || teamId);
    const squadUrl = `${base}/clients/${client}/${sportPath}/get_squad?team=${encodeURIComponent(extTeamId)}&client=${client}&authkey=${authkey}&ftype=json_array&season=${encodeURIComponent(season)}`;
    const r = await axios.get(squadUrl, {
      timeout: 120000,
      headers: { Accept: 'application/json', 'User-Agent': 'ZentagAI/1.0 (+studio.zentag.ai)' },
      auth: { username: basicUser, password: basicPass },
      validateStatus: () => true,
    });
    if (r.status < 200 || r.status >= 300) {
      return res.status(502).json({ success: false, message: `Upstream error status ${r.status}` });
    }
    const data = Array.isArray(r.data) ? r.data[0] : r.data;
    const ds = data?.datasportsgroup;
    const teamNode = ds?.team?.[0] || {};
    const teamName = String(teamNode?.team_name || '').trim();
    const country = String(teamNode?.area_name || '').trim();
    const peopleArr = teamNode?.people || [];
    // Create team if requested and not exists
    if (!teamDoc && req.body?.createTeam) {
      const newTeamPayload = {
        id: shortid.generate(),
        userId,
        seasonId: season,
        name: teamName || String(teamId),
        playerIds: [],
        players: [],
        category : reqCategory,
        isDatafeed: true,
        team_id: extTeamId,
        country: String(teamNode?.team_area_name || ''),
      };
      teamDoc = await Team.create(newTeamPayload);
    }
    let created = 0, updated = 0;
    const createdIds = [];
    for (const p of peopleArr) {
      const isCricket = String(tagCategory).toLowerCase() === 'cricket';
      const stats = isCricket ? [] : (Array.isArray(p?.season_statistic) ? p.season_statistic : []);
      if (!isCricket && !stats.length) continue;
      const st = isCricket ? undefined : (stats.find(st => String(st?.season_id || '') === String(season)) || stats[0]);
      const peopleId = String(p?.people_id || '');
      if (!peopleId) continue;

      const filter = { createdBy: userId, category: tagCategory, tagType: 'player', 'metaData.peopleId': peopleId };

      // Check if tag exists - if so, skip update but keep for team linking
      const existingTag = await Tag.findOne(filter).select('_id').lean();
      if (existingTag) {
        createdIds.push(String(existingTag._id));
        continue;
      }

      const playerShort = String(p?.short_name || p?.common_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ')).trim();
      const playerCommon = String(p?.common_name || playerShort).trim();
      const jersey = isCricket
        ? String(p?.shirtnumber || p?.shirt_number || p?.jersey_number || '')
        : String(st?.shirtnumber || '');
      const nationality = String(p?.nationality || '');

      const update = {
        $set: {
          name: playerShort,
          createdBy: userId,
          category: tagCategory,
          tagType: 'player',
          isDatafeed: true,
          ...(organizationId ? { organization: organizationId } : {}),
          metaData: {
            playerName: playerCommon,
            jerseyNumber: jersey,
            nationality,
            peopleId,
            teamId: String(teamDoc?.id || ''),
            seasonId: season,
          },
        },
      };

      const tag = await Tag.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
      created++;
      if (tag?._id) createdIds.push(String(tag._id));
    }
    if (teamDoc && createdIds.length) {
      const existing = Array.isArray(teamDoc.playerIds) ? teamDoc.playerIds : [];
      const merged = Array.from(new Set([...(existing.map(String)), ...createdIds]));
      const tagsDocs = await Tag.find({ _id: { $in: merged } }).select('_id name metaData.playerName').lean();
      const playersArr = tagsDocs.map(t => ({ _id: t._id, name: String(t?.metaData?.playerName || t?.name || '') }));
      await Team.findByIdAndUpdate(
        teamDoc._id,
        {
          name: teamName || teamDoc.name,
          category: reqCategory,
          country,
          seasonId: season,
          team_id: extTeamId,
          isDatafeed: true,
          isSynced: true,
          playerIds: merged,
          players: playersArr
        },
        { new: true }
      );
    }
    return res.status(200).json({ success: true, message: 'Players imported', created, updated, teamId: extTeamId });
  } catch (error) {
    logger.error('importPlayersFromDSG error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to import players', error: error.message });
  }
};
// Get tag by ID
const getTagById = async (req, res) => {
  try {
    const { id } = req.params;

    const tag = await Tag.findOne({ _id: id, ...activeFilter(req) })
      .populate('creator', 'name email userId')
      .lean();

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found'
      });
    }

    res.status(200).json({
      success: true,
      data: tag
    });
  } catch (error) {
    console.error('Error fetching tag:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Bulk create tags (for seeding)
const bulkCreateTags = async (req, res) => {
  try {
    const { tags } = req.body;
    const createdBy = req.user.userId;

    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tags array is required and should not be empty'
      });
    }

    // Add createdBy to all tags
    const tagsWithCreatedBy = tags.map(tag => ({
      ...tag,
      createdBy,
      name: tag.name.trim()
    }));

    const createdTags = await Tag.insertMany(tagsWithCreatedBy, { ordered: false });

    res.status(201).json({
      success: true,
      message: `${createdTags.length} tags created successfully`,
      data: createdTags
    });
  } catch (error) {
    console.error('Error bulk creating tags:', error);
    
    // Handle partial success in bulk insert
    if (error.writeErrors) {
      const successCount = error.result.insertedCount;
      return res.status(207).json({
        success: true,
        message: `${successCount} tags created successfully, ${error.writeErrors.length} failed due to duplicates`,
        insertedCount: successCount,
        errors: error.writeErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

export {
  getTagsByCategoryAndType,
  createTag,
  updateTag,
  deleteTag,
  getTagById,
  bulkCreateTags,
  importPlayersFromDSG
};
