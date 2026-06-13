import Team from '../models/Team.js';
import shortid from 'shortid';
import { getCurrentUserOrgId } from '../utils/organizationHelper.js';
import { activeFilter } from '../utils/softDelete.js';
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

const resolveTeamQuery = async (req, category, search, userId, organizationId) => {
  const orgIdForUser = await getCurrentUserOrgId(req);
  const query = { category, ...activeFilter(req) };
  if (organizationId) {
    query.organization = organizationId;
  } else if (orgIdForUser) {
    query.organization = orgIdForUser;
  } else if (userId) {
    query.userId = userId;
  } else {
    return { error: 'userId is required when not in an organization' };
  }
  if (search) {
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { team_id: { $regex: escaped, $options: 'i' } },
      { seasonId: { $regex: escaped, $options: 'i' } },
    ];
  }
  return { query };
};

// Create team
export const createTeam = async (req, res) => {
  try {
    const { name, playerIds, players: playersInput, category, teamImages = [], country = null, userId } = req.body;
    if (!name || !category || !Array.isArray(playerIds)) {
      return res.status(400).json({ success: false, message: 'name, category, playerIds are required' });
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    // Ensure uniqueness per user and category
    const exists = await Team.findOne({ name: name.trim(), category, userId, ...activeFilter(req) });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Team already exists for this category' });
    }

    // Build players array {_id, name}
    let players = Array.isArray(playersInput) ? playersInput.map(p => ({ _id: p._id, name: p.name })) : [];
    if (!players.length && playerIds.length) {
      try {
        const Tag = (await import('../models/Tag.js')).default;
        const ids = playerIds.map(String);
        const tags = await Tag.find({ _id: { $in: ids } }).select('_id name metaData.playerName').lean();
        players = tags.map(t => ({ _id: t._id, name: String(t?.metaData?.playerName || t?.name || '') }));
      } catch {}
    }

    const organizationId = await getCurrentUserOrgId(req);
    const team = await Team.create({
      id: shortid.generate(),
      userId,
      ...(organizationId && { organization: organizationId }),
      name: name.trim(),
      playerIds,
      players,
      category,
      teamImages,
      country,
    });
    return res.status(201).json({ success: true, message: 'Team created successfully', data: team });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Update team
export const updateTeam = async (req, res) => {
  try {
    const { _id, name, playerIds, players: playersInput, category, teamImages, country } = req.body;
    if (!_id) return res.status(400).json({ success: false, message: '_id is required' });

    const team = await Team.findOne({ _id, ...activeFilter(req) });
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const update = {};
    if (name) update.name = name.trim();
    if (Array.isArray(playerIds)) update.playerIds = playerIds;
    if (Array.isArray(playersInput)) update.players = playersInput.map(p => ({ _id: p._id, name: p.name }));
    else if (Array.isArray(playerIds)) {
      try {
        const Tag = (await import('../models/Tag.js')).default;
        const ids = playerIds.map(String);
        const tags = await Tag.find({ _id: { $in: ids } }).select('_id name metaData.playerName').lean();
        update.players = tags.map(t => ({ _id: t._id, name: String(t?.metaData?.playerName || t?.name || '') }));
      } catch {}
    }
    if (category) update.category = category;
    if (teamImages) update.teamImages = teamImages;
    if (country !== undefined) update.country = country || null;

    Object.assign(update, getAuditStamp(req));
    const updated = await Team.findOneAndUpdate({ _id, ...activeFilter(req) }, update, { new: true });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'update',
      entity: 'team',
      entityId: updated?.id || updated?._id?.toString?.(),
      orgId: updated?.organization || null,
      metadata: { fields: Object.keys(update || {}) },
    });
    return res.status(200).json({ success: true, message: 'Team updated successfully', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Delete team
export const deleteTeam = async (req, res) => {
  try {
    const { _id } = req.body;
    if (!_id) return res.status(400).json({ success: false, message: '_id is required' });
    const team = await Team.findOneAndUpdate(
      { _id, ...activeFilter(req) },
      { $set: getSoftDeleteStamp(req) },
      { new: true }
    );
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'delete',
      entity: 'team',
      entityId: team.id || team._id?.toString?.(),
      orgId: team.organization || null,
    });
    return res.status(200).json({ success: true, message: 'Team deleted successfully', data: { _id: team._id } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Get teams (paginated) — org members see org's teams
export const getTeams = async (req, res) => {
  try {
    const { category, search = '', limit = 10, pageNo = 1, userId, organizationId } = req.body;
    if (!category) return res.status(400).json({ success: false, message: 'category is required' });
    const resolved = await resolveTeamQuery(req, category, search, userId, organizationId);
    if (resolved.error) return res.status(400).json({ success: false, message: resolved.error });
    const { query } = resolved;

    const skip = (Number(pageNo) - 1) * Number(limit);
    const [totalCount, teams] = await Promise.all([
      Team.countDocuments(query),
      Team.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    ]);

    return res.status(200).json({ success: true, message: 'Teams get successfully', teams, totalCount });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Get all teams for edit (no pagination) — org members see org's teams
export const getAllEditTeams = async (req, res) => {
  try {
    const { category, search = '', userId, organizationId } = req.body;
    if (!category) return res.status(400).json({ success: false, message: 'category is required' });
    const resolved = await resolveTeamQuery(req, category, search, userId, organizationId);
    if (resolved.error) return res.status(400).json({ success: false, message: resolved.error });
    const { query } = resolved;
    const teams = await Team.find(query).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, message: 'Teams get successfully', teams });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
