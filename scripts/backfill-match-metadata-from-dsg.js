/**
 * Maintenance script: backfill or refresh MatchMetadata from DSG and stream titles.
 *
 * Usage:
 *   node scripts/backfill-match-metadata-from-dsg.js
 *   node scripts/backfill-match-metadata-from-dsg.js --limit=200
 *   node scripts/backfill-match-metadata-from-dsg.js --organizationId=<mongoObjectId>
 *   node scripts/backfill-match-metadata-from-dsg.js --refresh-incomplete
 *
 * Behavior:
 * 1. Streams WITH matchId  → fetch metadata from DSG API (existing behavior)
 * 2. Streams WITHOUT matchId → parse the stream title to create basic metadata
 * 3. Ensures every stream gets a MatchMetadata entry with organization set
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const NODE_ENV = process.env.NODE_ENV || "development";
const MONGO_URI =
  NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD || process.env.MONGO_URI
    : process.env.MONGO_URI_DEV ||
      process.env.MONGO_URI ||
      "mongodb://localhost:27017/dev-zentag";

function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function isMatchMetadataIncomplete(doc) {
  const payload = doc?.payload || {};
  const teams = Array.isArray(payload.teams) ? payload.teams.filter(Boolean) : [];
  return (
    !String(payload.matchName || "").trim() ||
    !String(payload.competition || "").trim() ||
    !String(payload.session || "").trim() ||
    teams.length === 0
  );
}

/**
 * Parse a stream title like "Serie-C Girone C - Benevento Vs Siracusa"
 * into a basic MatchMetadata payload.
 */
function parsePayloadFromTitle(title, stream) {
  const payload = {
    matchName: "",
    matchDate: "",
    matchDay: "",
    teams: [],
    venue: "",
    competition: "",
    season: "",
    session: "",
    scoreA: null,
    scoreB: null,
  };

  if (!title) return payload;

  payload.matchName = title.trim();

  if (stream?.matchDate) {
    const d = new Date(stream.matchDate);
    if (!Number.isNaN(d.getTime())) {
      payload.matchDate = d.toISOString().split("T")[0];
    }
  }

  const vsPatterns = [/ [Vv][Ss]\.? /, / versus /i, / v /];
  let competitionPart = "";
  let teamsPart = title.trim();

  const dashIdx = title.indexOf(" - ");
  if (dashIdx > 0) {
    competitionPart = title.slice(0, dashIdx).trim();
    teamsPart = title.slice(dashIdx + 3).trim();
  }

  for (const pattern of vsPatterns) {
    if (pattern.test(teamsPart)) {
      const parts = teamsPart.split(pattern).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        payload.teams = [parts[0], parts[1]];
      }
      break;
    }
  }

  if (competitionPart) {
    payload.competition = competitionPart;
  }

  return payload;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  const dbName = mongoose.connection.db?.databaseName || "unknown";
  console.log("Connected to MongoDB, database:", dbName);

  const Stream = (await import("../src/models/Stream.js")).default;
  const MatchMetadata = (await import("../src/models/MatchMetadata.js")).default;
  const { fetchAndParseMatchMetadata } = await import(
    "../src/services/dsgMatchService.js"
  );

  const organizationId = getArgValue("organizationId");
  const refreshIncomplete =
    hasFlag("refresh-incomplete") || hasFlag("refreshIncomplete");
  const limit = Math.min(
    1000,
    Math.max(1, parseInt(getArgValue("limit") || "500", 10)),
  );

  const orgFilter = {};
  if (organizationId) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new Error(`Invalid organizationId: ${organizationId}`);
    }
    orgFilter.organization = new mongoose.Types.ObjectId(organizationId);
  }

  // ── Phase 0: Load ALL streams ──────────────────────────────────────
  const allStreams = await Stream.find(orgFilter)
    .select("streamId matchId organization category title matchDate team1Id team2Id tournamentId")
    .lean();

  const withMatchId = allStreams.filter((s) => s.matchId && String(s.matchId).trim());
  const withoutMatchId = allStreams.filter((s) => !s.matchId || !String(s.matchId).trim());

  console.log(`\nTotal streams: ${allStreams.length}`);
  console.log(`  With matchId: ${withMatchId.length}`);
  console.log(`  Without matchId: ${withoutMatchId.length}`);

  // Load ALL existing MatchMetadata (by streamId and matchId)
  const allStreamIds = allStreams.map((s) => s.streamId).filter(Boolean);
  const allMatchIds = [...new Set(withMatchId.map((s) => String(s.matchId).trim()))];

  const [existingByStreamId, existingByMatchId] = await Promise.all([
    allStreamIds.length
      ? MatchMetadata.find({ streamId: { $in: allStreamIds } }).select("streamId matchId payload organization").lean()
      : [],
    allMatchIds.length
      ? MatchMetadata.find({ matchId: { $in: allMatchIds } }).select("streamId matchId payload organization").lean()
      : [],
  ]);

  const metaByStreamId = new Map(
    existingByStreamId.map((d) => [d.streamId, d]),
  );
  const metaByMatchId = new Map(
    existingByMatchId.map((d) => [String(d.matchId).trim(), d]),
  );

  const coveredStreamIds = new Set([
    ...existingByStreamId.map((d) => d.streamId),
  ]);
  const coveredMatchIds = new Set([
    ...existingByMatchId.map((d) => String(d.matchId).trim()),
  ]);

  const totalExisting = new Set([
    ...existingByStreamId.map((d) => d.streamId),
    ...existingByMatchId.map((d) => d.streamId).filter(Boolean),
  ]).size;

  console.log(`\nExisting MatchMetadata: ${existingByStreamId.length} by streamId, ${existingByMatchId.length} by matchId`);
  console.log(`Streams already covered: ${totalExisting}`);

  let dsgBackfilled = 0;
  let dsgRefreshed = 0;
  let dsgFailed = 0;
  let titleBackfilled = 0;
  let titleRefreshed = 0;
  let orgFixed = 0;
  let skipped = 0;

  // ── Phase 1: Streams WITH matchId → DSG API ───────────────────────
  console.log(`\n── Phase 1: DSG backfill (streams with matchId) ──`);

  const dsgTargets = [];
  for (const stream of withMatchId) {
    const mid = String(stream.matchId).trim();
    const existing = metaByMatchId.get(mid);
    if (existing && !refreshIncomplete) {
      if (!existing.organization && stream.organization) {
        orgFixed += 1;
        await MatchMetadata.updateOne(
          { matchId: mid },
          { $set: { organization: stream.organization, streamId: stream.streamId || existing.streamId || "" } },
        );
        console.log(`  [ORG-FIX] ${mid} → org=${stream.organization} (${stream.title || ""})`);
      }
      continue;
    }
    if (existing && refreshIncomplete && !isMatchMetadataIncomplete(existing)) {
      if (!existing.organization && stream.organization) {
        orgFixed += 1;
        await MatchMetadata.updateOne(
          { matchId: mid },
          { $set: { organization: stream.organization, streamId: stream.streamId || existing.streamId || "" } },
        );
      }
      continue;
    }
    dsgTargets.push({ stream, matchId: mid, wasExisting: !!existing });
  }

  console.log(`  DSG targets: ${dsgTargets.length} (missing or incomplete)`);

  for (const { stream, matchId, wasExisting } of dsgTargets.slice(0, limit)) {
    const category = (stream.category || "others") === "football" ? "soccer" : (stream.category || "others");
    try {
      const payload = await fetchAndParseMatchMetadata(matchId, category);
      await MatchMetadata.findOneAndUpdate(
        { matchId },
        {
          $set: {
            streamId: stream.streamId || "",
            organization: stream.organization || null,
            category: stream.category || "",
            payload,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );
      if (wasExisting) dsgRefreshed += 1;
      else dsgBackfilled += 1;
      console.log(
        `  [DSG-OK] ${matchId} ${wasExisting ? "(refreshed)" : "(backfilled)"} - ${stream.title || ""}`,
      );
    } catch (error) {
      dsgFailed += 1;
      console.warn(
        `  [DSG-FAIL] ${matchId} -`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // ── Phase 2: Streams WITHOUT matchId → parse title ─────────────────
  console.log(`\n── Phase 2: Title-based backfill (streams without matchId) ──`);

  const titleTargets = [];
  for (const stream of withoutMatchId) {
    const sid = stream.streamId;
    if (!sid) continue;
    const existing = metaByStreamId.get(sid);
    if (existing && !refreshIncomplete) {
      if (!existing.organization && stream.organization) {
        orgFixed += 1;
        await MatchMetadata.updateOne(
          { streamId: sid },
          { $set: { organization: stream.organization } },
        );
        console.log(`  [ORG-FIX] streamId=${sid} → org=${stream.organization} (${stream.title || ""})`);
      }
      skipped += 1;
      continue;
    }
    if (existing && refreshIncomplete && !isMatchMetadataIncomplete(existing)) {
      if (!existing.organization && stream.organization) {
        orgFixed += 1;
        await MatchMetadata.updateOne(
          { streamId: sid },
          { $set: { organization: stream.organization } },
        );
      }
      skipped += 1;
      continue;
    }
    titleTargets.push({ stream, existing });
  }

  console.log(`  Title targets: ${titleTargets.length} (need metadata)`);
  console.log(`  Skipped (already complete): ${skipped}`);

  for (const { stream, existing } of titleTargets.slice(0, limit)) {
    const sid = stream.streamId;
    const title = stream.title || "";
    const syntheticMatchId = `title:${sid}`;
    const payload = parsePayloadFromTitle(title, stream);

    try {
      await MatchMetadata.findOneAndUpdate(
        { streamId: sid },
        {
          $set: {
            matchId: existing?.matchId || syntheticMatchId,
            streamId: sid,
            organization: stream.organization || null,
            category: stream.category || "",
            payload,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );
      if (existing) titleRefreshed += 1;
      else titleBackfilled += 1;
      const teamStr = payload.teams.length ? ` [${payload.teams.join(" vs ")}]` : "";
      const compStr = payload.competition ? ` comp="${payload.competition}"` : "";
      console.log(
        `  [TITLE-OK] streamId=${sid}${compStr}${teamStr} - ${title || "(no title)"}`,
      );
    } catch (error) {
      console.warn(
        `  [TITLE-FAIL] streamId=${sid} -`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("Backfill complete.");
  console.log(`  Total streams processed: ${allStreams.length}`);
  console.log(`  DSG backfilled: ${dsgBackfilled}`);
  console.log(`  DSG refreshed: ${dsgRefreshed}`);
  console.log(`  DSG failed: ${dsgFailed}`);
  console.log(`  Title-parsed backfilled: ${titleBackfilled}`);
  console.log(`  Title-parsed refreshed: ${titleRefreshed}`);
  console.log(`  Organization fixed: ${orgFixed}`);
  console.log(`  Skipped (already complete): ${skipped}`);
  console.log(`  Refresh incomplete: ${refreshIncomplete ? "yes" : "no"}`);
  console.log("══════════════════════════════════════════");

  await mongoose.disconnect();
  process.exit(dsgFailed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
