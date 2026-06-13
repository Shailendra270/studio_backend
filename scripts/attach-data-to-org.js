/**
 * One-off migration: attach existing user-owned data to each user's organization.
 * For each User we get their org from OrganizationMember (first membership),
 * then set organization on every table that has userId (or createdBy) so that
 * existing rows are linked to the user's organization. Idempotent: only sets
 * organization when it is null/undefined.
 *
 * Tables: Stream, Clip, Folder (clipList), Team, Tag, Competition, VideoTemplate,
 * PreStreamTemplate, Graphic, Bumper.
 *
 * Prerequisite: run migrate-existing-users-to-org.js first so every user has an org.
 *
 * Run: npm run migrate:attach-data-to-org  (from backend root)
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from root .env
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGO_URI;

const noOrg = { $or: [{ organization: null }, { organization: { $exists: false } }] };

async function run() {
  await mongoose.connect(MONGO_URI);
  const dbName = mongoose.connection.db?.databaseName || "unknown";
  console.log("Connected to MongoDB, database:", dbName);

  const User = (await import("../src/models/User.js")).default;
  const OrganizationMember = (
    await import("../src/models/OrganizationMember.js")
  ).default;
  const Stream = (await import("../src/models/Stream.js")).default;
  const Clip = (await import("../src/models/Clip.js")).default;
  const clipList = (await import("../src/models/Folder.js")).default;
  const Team = (await import("../src/models/Team.js")).default;
  const Tag = (await import("../src/models/Tag.js")).default;
  const Competition = (await import("../src/models/Competition.js")).default;
  const VideoTemplate = (await import("../src/models/VideoTemplate.js")).default;
  const PreStreamTemplate = (await import("../src/models/PreStreamTemplate.js")).default;
  const Graphic = (await import("../src/models/Graphic.js")).default;
  const Bumper = (await import("../src/models/Bumper.js")).default;

  const users = await User.find({}).select("_id userId").lean();
  let streamsUpdated = 0;
  let clipsUpdated = 0;
  let foldersUpdated = 0;
  let teamsUpdated = 0;
  let tagsUpdated = 0;
  let competitionsUpdated = 0;
  let videoTemplatesUpdated = 0;
  let preStreamTemplatesUpdated = 0;
  let graphicsUpdated = 0;
  let bumpersUpdated = 0;
  let usersSkipped = 0;

  for (const user of users) {
    const membership = await OrganizationMember.findOne({
      user: user._id,
      status: "Active",
    })
      .select("organization")
      .lean();
    if (!membership?.organization) {
      usersSkipped++;
      continue;
    }
    const orgId = membership.organization;
    const userUserId = user.userId;
    const userObjectId = user._id;

    const streamRes = await Stream.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    streamsUpdated += streamRes.modifiedCount;

    const clipRes1 = await Clip.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    const clipRes2 = await Clip.updateMany(
      { createdBy: userObjectId, ...noOrg },
      { $set: { organization: orgId } },
    );
    clipsUpdated += clipRes1.modifiedCount + clipRes2.modifiedCount;

    const folderRes = await clipList.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    foldersUpdated += folderRes.modifiedCount;

    const teamRes = await Team.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    teamsUpdated += teamRes.modifiedCount;

    const tagRes = await Tag.updateMany(
      { createdBy: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    tagsUpdated += tagRes.modifiedCount;

    const competitionRes = await Competition.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    competitionsUpdated += competitionRes.modifiedCount;

    const videoTemplateRes = await VideoTemplate.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    videoTemplatesUpdated += videoTemplateRes.modifiedCount;

    const preStreamTemplateRes = await PreStreamTemplate.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    preStreamTemplatesUpdated += preStreamTemplateRes.modifiedCount;

    const graphicRes = await Graphic.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    graphicsUpdated += graphicRes.modifiedCount;

    const bumperRes = await Bumper.updateMany(
      { userId: userUserId, ...noOrg },
      { $set: { organization: orgId } },
    );
    bumpersUpdated += bumperRes.modifiedCount;
  }

  console.log("\nAttach-data-to-org complete.");
  console.log("Streams updated:", streamsUpdated);
  console.log("Clips updated:", clipsUpdated);
  console.log("Folders (highlights) updated:", foldersUpdated);
  console.log("Teams updated:", teamsUpdated);
  console.log("Tags updated:", tagsUpdated);
  console.log("Competitions updated:", competitionsUpdated);
  console.log("VideoTemplates updated:", videoTemplatesUpdated);
  console.log("PreStreamTemplates updated:", preStreamTemplatesUpdated);
  console.log("Graphics updated:", graphicsUpdated);
  console.log("Bumpers updated:", bumpersUpdated);
  console.log("Users skipped (no org membership):", usersSkipped);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
