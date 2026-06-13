/**
 * Backfill organizationId on clips and highlights (folders).
 * For each clip and folder that has no organization set, we take the entry's userId
 * (or for clips, createdBy), fetch that user and their org from OrganizationMember,
 * and set organization on the entry.
 *
 * Run from backend root: npm run script:backfill-clip-highlight-org
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  await mongoose.connect(MONGO_URI);
  const dbName = mongoose.connection.db?.databaseName || "unknown";
  console.log("Connected to MongoDB, database:", dbName);

  const User = (await import("../src/models/User.js")).default;
  const OrganizationMember = (
    await import("../src/models/OrganizationMember.js")
  ).default;
  const Clip = (await import("../src/models/Clip.js")).default;
  const clipList = (await import("../src/models/Folder.js")).default;

  const noOrg = { $or: [{ organization: null }, { organization: { $exists: false } }] };

  // ---- Clips: get distinct userId (string) and createdBy (ObjectId) where organization is missing
  const clipsMissingOrg = await Clip.find({
    ...noOrg,
    $or: [
      { userId: { $exists: true, $ne: null, $ne: "" } },
      { createdBy: { $exists: true, $ne: null } },
    ],
  })
    .select("userId createdBy")
    .lean();

  const userIdsFromClips = [
    ...new Set(
      clipsMissingOrg
        .map((c) => c.userId)
        .filter((id) => id && typeof id === "string" && id.trim() !== "")
    ),
  ];
  const createdByIdsFromClips = [
    ...new Set(
      clipsMissingOrg
        .map((c) => c.createdBy)
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  // ---- Folders (highlights): get distinct userId where organization is missing
  const foldersMissingOrg = await clipList.find({
    ...noOrg,
    userId: { $exists: true, $ne: null, $ne: "" },
  })
    .select("userId")
    .lean();

  const userIdsFromFolders = [
    ...new Set(
      foldersMissingOrg
        .map((f) => f.userId)
        .filter((id) => id && typeof id === "string" && id.trim() !== "")
    ),
  ];

  const allUserIds = [...new Set([...userIdsFromClips, ...userIdsFromFolders])];

  // Build userId (string) -> orgId map
  const userIdToOrgId = new Map();
  for (const uid of allUserIds) {
    const user = await User.findOne({ userId: uid }).select("_id").lean();
    if (!user?._id) continue;
    const member = await OrganizationMember.findOne({
      user: user._id,
      status: "Active",
    })
      .select("organization")
      .sort({ joinedAt: 1 })
      .lean();
    if (member?.organization) userIdToOrgId.set(uid, member.organization);
  }

  // Build createdBy (ObjectId) -> orgId map for clips
  const createdByToOrgId = new Map();
  for (const createdById of createdByIdsFromClips) {
    const member = await OrganizationMember.findOne({
      user: createdById,
      status: "Active",
    })
      .select("organization")
      .sort({ joinedAt: 1 })
      .lean();
    if (member?.organization) createdByToOrgId.set(createdById.toString(), member.organization);
  }

  let clipsUpdatedByUserId = 0;
  let clipsUpdatedByCreatedBy = 0;
  let foldersUpdated = 0;

  for (const [uid, orgId] of userIdToOrgId) {
    const r1 = await Clip.updateMany(
      { ...noOrg, userId: uid },
      { $set: { organization: orgId } }
    );
    clipsUpdatedByUserId += r1.modifiedCount;

    const r2 = await clipList.updateMany(
      { ...noOrg, userId: uid },
      { $set: { organization: orgId } }
    );
    foldersUpdated += r2.modifiedCount;
  }

  for (const [createdByIdStr, orgId] of createdByToOrgId) {
    const createdByObjId = new mongoose.Types.ObjectId(createdByIdStr);
    const r = await Clip.updateMany(
      { ...noOrg, createdBy: createdByObjId },
      { $set: { organization: orgId } }
    );
    clipsUpdatedByCreatedBy += r.modifiedCount;
  }

  const totalClipsUpdated = clipsUpdatedByUserId + clipsUpdatedByCreatedBy;
  console.log("\nBackfill clip/highlight organization complete.");
  console.log("Clips updated (by userId):", clipsUpdatedByUserId);
  console.log("Clips updated (by createdBy):", clipsUpdatedByCreatedBy);
  console.log("Clips total updated:", totalClipsUpdated);
  console.log("Highlights (folders) updated:", foldersUpdated);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
