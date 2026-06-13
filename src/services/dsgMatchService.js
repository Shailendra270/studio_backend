/**
 * Fetch match metadata from DSG API and parse to enriched payload for Media Library.
 * Used to populate MatchMetadata cache and avoid repeated DSG calls.
 */
import axios from 'axios';
import logger from '../utils/logger.js';

/**
 * Fetch raw match payload from DSG (same as getMatchMetadata controller).
 * @param {string} matchId - 7-digit match id
 * @param {string} [category='soccer'] - sport (soccer/football, etc.)
 * @returns {Promise<object|null>} Raw DSG payload (first element if array) or null
 */
export async function fetchMatchFromDSG(matchId, category = 'soccer') {
  const authkey = process.env.DSG_AUTHKEY || '';
  if (!authkey) {
    logger.warn('DSG_AUTHKEY not configured; skipping match fetch');
    return null;
  }
  const base = process.env.DSG_API_BASE || 'https://dsg-api.com';
  const client = process.env.DSG_CLIENT || 'dataaistream';
  const sport = String(category || 'soccer').toLowerCase();
  const sportPath = sport === 'football' ? 'soccer' : sport;
  const url = `${base}/clients/${client}/${sportPath}/get_matches?type=match&id=${encodeURIComponent(matchId)}&client=${client}&authkey=${authkey}&ftype=json_array`;
  try {
    const r = await axios.get(url, {
      timeout: 15000,
      headers: { Accept: 'application/json', 'User-Agent': 'ZentagAI/1.0 (+studio.zentag.ai)' },
      auth: {
        username: client,
        password: process.env.DSG_BASIC_PASS || '',
      },
      validateStatus: () => true,
    });
    if (r.status !== 200) return null;
    const data = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : r.data;
    const first = Array.isArray(data) ? data[0] : data;
    return first || null;
  } catch (err) {
    logger.warn('fetchMatchFromDSG error:', err?.message || err);
    return null;
  }
}

/**
 * Parse DSG raw payload to enriched payload (first match only).
 * Mirrors frontend extractMatchData structure for one match.
 * @param {object} apiResponse - Raw DSG response (single item)
 * @returns {object} { matchName, matchDate, teams, venue, competition, season, session }
 */
export function parseMatchPayload(apiResponse) {
  const out = {
    matchName: '',
    matchDate: '',
    matchDay: '',
    teams: [],
    venue: '',
    competition: '',
    season: '',
    session: '',
    scoreA: null,
    scoreB: null,
  };
  const ds = apiResponse?.datasportsgroup ?? apiResponse ?? {};
  const tours = ds?.tour ?? [];
  for (const tour of tours) {
    const seasons = tour?.tour_season ?? [];
    for (const ts of seasons) {
      const competitions = ts?.competition ?? [];
      for (const comp of competitions) {
        const compSeasons = comp?.season ?? [];
        for (const season of compSeasons) {
          const disciplines = season?.discipline ?? [];
          for (const disc of disciplines) {
            const genders = disc?.gender ?? [];
            for (const gen of genders) {
              const rounds = gen?.round ?? [];
              for (const rnd of rounds) {
                const lists = rnd?.list ?? [];
                for (const list of lists) {
                  const matches = list?.match ?? [];
                  for (const match of matches) {
                    const teamAName = String(match?.team_a_name ?? '').trim();
                    const teamBName = String(match?.team_b_name ?? '').trim();
                    out.matchName = teamAName && teamBName ? `${teamAName} vs ${teamBName}` : teamAName || teamBName || 'Match';
                    out.matchDate = String(match?.date ?? '');
                    out.teams = [teamAName, teamBName].filter(Boolean);
                    const venueNode = match?.match_extra?.[0]?.venue?.[0];
                    out.venue = venueNode ? String(venueNode?.venue_name ?? venueNode?.venue_city ?? '').trim() : '';
                    const compNode = comp ?? {};
                    out.competition = String(compNode?.name ?? '').trim();
                    const seasonNode = season ?? {};
                    out.season = String(seasonNode?.title ?? seasonNode?.original_name ?? '').trim();
                    const roundNode = rnd ?? {};
                    const roundName = String(roundNode?.name ?? '').trim();
                    out.session = roundName;
                    out.matchDay = roundName;
                    const a = Number(match?.score_a);
                    const b = Number(match?.score_b);
                    out.scoreA = Number.isFinite(a) ? a : null;
                    out.scoreB = Number.isFinite(b) ? b : null;
                    return out;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Fetch from DSG and return enriched payload for cache.
 * @param {string} matchId
 * @param {string} [category='soccer']
 * @returns {Promise<object>} Enriched payload (never null; may be empty strings)
 */
export async function fetchAndParseMatchMetadata(matchId, category = 'soccer') {
  const raw = await fetchMatchFromDSG(matchId, category);
  return raw ? parseMatchPayload(raw) : parseMatchPayload({});
}
