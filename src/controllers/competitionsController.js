import Competition from '../models/Competition.js';
import Team from '../models/Team.js';
import Tag from '../models/Tag.js';
import shortid from 'shortid';
import axios from 'axios';
import logger from '../utils/logger.js';
import { getCurrentUserOrgId } from '../utils/organizationHelper.js';
import { activeFilter } from '../utils/softDelete.js';
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

// Create competition
export const createCompetition = async (req, res) => {
  try {
    const { name, category, teams: teamsInput = [], teamIds = [], userId } = req.body;
    if (!name || !category || !userId) {
      return res.status(400).json({ success: false, message: 'name, category, userId are required' });
    }

    const exists = await Competition.findOne({ userId, name: name.trim(), category, ...activeFilter(req) });
    if (exists) {
      return res.json({ success: false, message: 'Competition name already exists for this category' });
    }

    const competitionId = shortid.generate();
    // Build teams array objects
    let teams = Array.isArray(teamsInput) ? teamsInput.map(t => ({ teamId: t.teamId, name: t.name })) : [];
    if (!teams.length && Array.isArray(teamIds) && teamIds.length) {
      const docs = await Team.find({ id: { $in: teamIds } }).select('id name').lean();
      teams = docs.map(d => ({ teamId: d.id, name: d.name }));
    }
    const competition = await Competition.create({ id: competitionId, userId, name: name.trim(), category, teams });
    return res.status(201).json({ success: true, message: 'Competition created successfully', data: competition });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Update competition
export const updateCompetition = async (req, res) => {
  try {
    const { _id, name, category, teams: teamsInput, teamIds } = req.body;
    if (!_id) return res.status(400).json({ success: false, message: '_id is required' });

    const competition = await Competition.findOne({ _id, ...activeFilter(req) });
    if (!competition) return res.status(404).json({ success: false, message: 'Competition not found' });

    const update = {};
    if (name) update.name = name.trim();
    if (category) update.category = category;
    if (Array.isArray(teamsInput)) {
      update.teams = teamsInput.map(t => ({ teamId: t.teamId, name: t.name }));
    } else if (Array.isArray(teamIds)) {
      const docs = await Team.find({ id: { $in: teamIds } }).select('id name').lean();
      update.teams = docs.map(d => ({ teamId: d.id, name: d.name }));
    }

    Object.assign(update, getAuditStamp(req));
    const updated = await Competition.findOneAndUpdate({ _id, ...activeFilter(req) }, update, { new: true });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'update',
      entity: 'competition',
      entityId: updated?.id || updated?._id?.toString?.(),
      orgId: updated?.organization || null,
      metadata: { fields: Object.keys(update || {}) },
    });
    return res.status(200).json({ success: true, message: 'Competition updated successfully', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Delete competition
export const deleteCompetition = async (req, res) => {
  try {
    const { _id } = req.body;
    if (!_id) return res.status(400).json({ success: false, message: '_id is required' });
    const doc = await Competition.findOneAndUpdate(
      { _id, ...activeFilter(req) },
      { $set: getSoftDeleteStamp(req) },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Competition not found' });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'delete',
      entity: 'competition',
      entityId: doc.id || doc._id?.toString?.(),
      orgId: doc.organization || null,
    });
    return res.status(200).json({ success: true, message: 'Competition deleted successfully', data: { _id: doc._id } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Get competitions (paginated; category optional)
export const getCompetitions = async (req, res) => {
  try {
    const { category, search = '', limit = 10, pageNo = 1, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    const query = { userId, ...activeFilter(req) };
    if (category) query.category = category;
    if (search) {
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [{ name: { $regex: escaped, $options: 'i' } }];
    }

    const skip = (Number(pageNo) - 1) * Number(limit);
    const [totalCount, competitions] = await Promise.all([
      Competition.countDocuments(query),
      Competition.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    ]);

    return res.status(200).json({ success: true, message: 'Competitions get successfully', competitions, totalCount });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

export const syncCompetitionFromDSG = async (req, res) => {
  try {  
    const seasonId = req.params.seasonId || req.query.seasonId;
    const userId = req.query?.userId || req.body?.userId;
    const category = req.query?.category || req.body?.category || 'Soccer';
    const disciplineId = req.query?.disciplineId || req.body?.disciplineId;
    const requestedTeamIdsRaw = req.query?.teamIds || req.body?.teamIds || req.query?.teamId || req.body?.teamId;
    const requestedTeamIds = (() => {
      if (!requestedTeamIdsRaw) return [];
      if (Array.isArray(requestedTeamIdsRaw)) {
        return Array.from(new Set(requestedTeamIdsRaw.map(v => String(v).trim()).filter(Boolean)));
      }
      const s = String(requestedTeamIdsRaw).trim();
      if (!s) return [];
      return Array.from(new Set(s.split(',').map(v => v.trim()).filter(Boolean)));
    })();
    if (!seasonId || !/^\d{5}$/.test(String(seasonId))) {
      return res.status(400).json({ success: false, message: 'seasonId (5 digits) is required' });
    }
    if (!disciplineId || !/^\d{1,5}$/.test(String(disciplineId)) || Number(disciplineId) < 1) {
      return res.status(400).json({ success: false, message: 'disciplineId (1–5 digits, numeric >= 1) is required' });
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }
    const organizationId = await getCurrentUserOrgId(req);
    const base = process.env.DSG_API_BASE || 'https://dsg-api.com';
    const client = process.env.DSG_CLIENT || 'dataaistream';
    const authkey = process.env.DSG_AUTHKEY || '';
    const basicUser = client;
    const basicPass = process.env.DSG_BASIC_PASS || '';
    if (!authkey) {
      return res.status(500).json({ success: false, message: 'DSG_AUTHKEY is not configured' });
    }
    const sportPath = String(category).toLowerCase() === 'football' ? 'soccer' : String(category);
    const url = `${base}/clients/${client}/${sportPath}/get_contestants?client=${client}&authkey=${authkey}&type=discipline&type_id=${encodeURIComponent(
      disciplineId
    )}&season=${encodeURIComponent(seasonId)}&ftype=json_array`;
    const r = await axios.get(url, {
      timeout: 150000,
      headers: { Accept: 'application/json', 'User-Agent': 'ZentagAI/1.0 (+studio.zentag.ai)' },
      auth: { username: basicUser, password: basicPass },
      validateStatus: () => true,
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(502).json({ success: false, message: 'Upstream unauthorized. Verify DSG credentials/whitelist.' });
    }
    if (r.status < 200 || r.status >= 300) {
      return res.status(502).json({ success: false, message: `Upstream error status ${r.status}` });
    }
    const data = Array.isArray(r.data) ? r.data[0] : r.data;
    const ds = data?.datasportsgroup;
    const compNode = ds?.tour?.[0]?.tour_season?.[0]?.competition?.[0] || {};
    const seasonNode = compNode?.season?.[0] || {};
    const discNode = seasonNode?.discipline?.[0] || {};
    const genderNode = discNode?.gender?.[0] || {};
    const teamArr = genderNode?.team || [];
    const teamByExtId = new Map(teamArr.map(t => [String(t?.team_id || ''), t]));
    const filteredTeamArr = requestedTeamIds.length
      ? requestedTeamIds.map(id => teamByExtId.get(String(id)) || null).filter(Boolean)
      : teamArr;
    const compPayload = {
      name: String(seasonNode?.original_name || compNode?.name || ''),
      title: String(seasonNode?.title || ''),
      category: String(discNode?.name || category) === "Soccer" ? "football" : category,
      userId,
      ...(organizationId ? { organization: organizationId } : {}),
      isDatafeed: true,
      competitionId: String(compNode?.competition_id || ''),
      seasonId: String(seasonNode?.season_id || seasonId),
      logo: String(seasonNode?.logo || ''),
      country: String(compNode?.area_name || ''),
      gender: String(compNode?.gender || genderNode?.value || ''),
      startDate: String(seasonNode?.start_date || ''),
      endDate: String(seasonNode?.end_date || ''),
    };
    let competition = await Competition.findOne({ userId, seasonId: compPayload.seasonId, ...activeFilter(req) });
    if (!competition) {
      const cid = shortid.generate();
      competition = await Competition.create({ id: cid, teams: [], ...compPayload });
    } else {
      competition = await Competition.findByIdAndUpdate(competition._id, compPayload, { new: true });
    }
    const teams = [];
    for (const t of filteredTeamArr) {
      const extId = String(t?.team_id || '');
      const name = String(t?.team_name || '');
      if (!extId || !name) continue;
      let team = await Team.findOne({ userId, team_id: extId, ...activeFilter(req) });
      const logoUrl = String(t?.team_logo || '');
      const doc = {
        userId,
        ...(organizationId ? { organization: organizationId } : {}),
        name,
        seasonId: compPayload.seasonId,
        category: compPayload.category === "Soccer" ? "football" : compPayload.category,
        isDatafeed: true,
        team_id: extId,
        country: String(t?.team_area_name || ''),
        teamImages: logoUrl ? [{ url: logoUrl, type: 'team_logo', name: 'logo' }] : [],
      };
      if (!team) {
        team = await Team.create({ id: shortid.generate(), ...doc });
      } else {
        team = await Team.findByIdAndUpdate(team._id, doc, { new: true });
      }
      // Fetch squad for team and create player tags
      try {
        const squadUrl = `${base}/clients/${client}/${sportPath}/get_squad?team=${encodeURIComponent(extId)}&client=${client}&authkey=${authkey}&ftype=json_array&season=${encodeURIComponent(
          compPayload.seasonId
        )}`;
        const sr = await axios.get(squadUrl, {
          timeout: 120000,
          headers: { Accept: 'application/json', 'User-Agent': 'ZentagAI/1.0 (+studio.zentag.ai)' },
          auth: { username: basicUser, password: basicPass },
          validateStatus: () => true,
        });
        if (sr.status >= 200 && sr.status < 300) {
          const sdata = Array.isArray(sr.data) ? sr.data[0] : sr.data;
          const sds = sdata?.datasportsgroup;
          const teamNode = sds?.team?.[0] || {};
          const peopleArr = teamNode?.people || [];
          const createdIds = [];
          for (const p of peopleArr) {
            const stats = Array.isArray(p?.season_statistic) ? p.season_statistic : [];
            if (!stats.length) continue;
            const st = stats.find(st => String(st?.season_id || '') === String(compPayload.seasonId)) || stats[0];
            const peopleId = String(p?.people_id || '');
            if (!peopleId) continue;
            const playerShort = String(p?.short_name || p?.common_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ')).trim();
            const playerCommon = String(p?.common_name || playerShort).trim();
            const jersey = String(st?.shirtnumber || '');
            const nationality = String(p?.nationality || '');
            const filter = { createdBy: userId, category: doc.category, tagType: 'player', 'metaData.peopleId': peopleId };
            const update = {
              $set: {
                name: playerShort,
                createdBy: userId,
                category: doc.category,
                tagType: 'player',
                isDatafeed: true,
                ...(organizationId ? { organization: organizationId } : {}),
                metaData: {
                  playerName: playerCommon,
                  jerseyNumber: jersey,
                  nationality,
                  peopleId,
                  teamId: team.id,
                  seasonId: compPayload.seasonId,
                },
              },
            };
            const tag = await Tag.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
            if (tag?._id) createdIds.push(String(tag._id));
          }
          const existing = Array.isArray(team?.playerIds) ? team.playerIds : [];
          const merged = Array.from(new Set([...(existing.map(String)), ...createdIds]));
          const tagsDocs = await Tag.find({ _id: { $in: merged } }).select('_id name metaData.playerName').lean();
          const playersArr = tagsDocs.map(t => ({ _id: t._id, name: String(t?.metaData?.playerName || t?.name || '') }));
          await Team.findByIdAndUpdate(team._id, { playerIds: merged, players: playersArr }, { new: true });
        } else {
          logger.warn(`Squad fetch failed for team ${extId} with status ${sr.status}`);
        }
      } catch (err) {
        logger.warn(`Squad fetch error for team ${extId}: ${err?.message || err}`);
      }
      teams.push({ teamId: team.id, name: team.name });
    }
    competition = await Competition.findByIdAndUpdate(competition._id, { teams }, { new: true });
    return res.status(200).json({
      success: true,
      message: 'Competition and teams synced successfully',
      data: { competition, teams, teamCount: teams.length },
    });
  } catch (error) {
    logger.error('syncCompetitionFromDSG error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to sync competition', error: error.message });
  }
};
