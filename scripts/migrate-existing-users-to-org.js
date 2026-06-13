/**
 * One-off migration: create ONE organization PER existing user and attach that user
 * as the only member (Org Admin). Existing user flow does not break — same User docs,
 * same refs from Streams/Clips/etc. We only add Organization + OrgRole + OrganizationMember.
 *
 * Idempotent: if a user already has any org membership, skip that user.
 *
 * Run: npm run migrate:users-to-org  (from backend root)
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from root .env
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGO_URI;
const RESET_ORGS =
  process.env.RESET_ORGS === "1" || process.argv.includes("--reset");

async function seedDefaultRolesForOrg(
  Organization,
  OrgRole,
  orgId,
  PRESET_PERMISSIONS,
  DEFAULT_ROLE_NAMES,
) {
  for (const name of DEFAULT_ROLE_NAMES) {
    const existing = await OrgRole.findOne({ organization: orgId, name });
    if (!existing) {
      await OrgRole.create({
        organization: orgId,
        name,
        isSystem: true,
        permissions: PRESET_PERMISSIONS[name] || {},
      });
    }
  }
}

async function run() {
  await mongoose.connect(MONGO_URI);
  const dbName = mongoose.connection.db?.databaseName || "unknown";
  console.log("Connected to MongoDB, database:", dbName);
  console.log("(In Compass, make sure you are viewing this same database.)");

  const Organization = (await import("../src/models/Organization.js")).default;
  const OrgRole = (await import("../src/models/OrgRole.js")).default;
  const OrganizationMember = (
    await import("../src/models/OrganizationMember.js")
  ).default;
  const User = (await import("../src/models/User.js")).default;
  const { PRESET_PERMISSIONS, DEFAULT_ROLE_NAMES } =
    await import("../src/constants/defaultRolePermissions.js");

  let orgCount = await Organization.countDocuments({});
  let memberCount = await OrganizationMember.countDocuments({});
  const userCount = await User.countDocuments({});
  console.log(
    "Current counts: users:",
    userCount,
    "| organizations:",
    orgCount,
    "| organizationmembers:",
    memberCount,
  );

  if (RESET_ORGS && (orgCount > 0 || memberCount > 0)) {
    console.log(
      "RESET_ORGS/--reset: clearing all organizationmembers, orgroles, organizations...",
    );
    await OrganizationMember.deleteMany({});
    await OrgRole.deleteMany({});
    await Organization.deleteMany({});
    orgCount = 0;
    memberCount = 0;
    console.log(
      "Cleared. New counts: organizations: 0, organizationmembers: 0.",
    );
  }

  // If both org and member collections are empty, treat as fresh run — do not skip anyone
  const forceCreateAll = orgCount === 0 && memberCount === 0;
  if (forceCreateAll) {
    console.log(
      "No orgs/members found — creating one org per user (fresh run).",
    );
  }

  const users = await User.find({})
    .select("_id name email")
    .sort({ createdAt: 1 })
    .lean();
  let created = 0;
  let skipped = 0;

  for (const user of users) {
    if (!forceCreateAll) {
      const alreadyMember = await OrganizationMember.findOne({
        user: user._id,
      });
      if (alreadyMember) {
        skipped++;
        continue;
      }
    }

    const orgName =
      user.name && user.name.trim()
        ? `${user.name.trim()}'s Organization`
        : `Organization ${user._id.toString().slice(-6)}`;
    const contactEmail =
      (user.email && user.email.trim()) ||
      `user-${user._id.toString().slice(-6)}@migrated.local`;

    const org = await Organization.create({
      name: orgName,
      contactEmail,
      contactPhone: "",
      status: "Active",
    });

    await seedDefaultRolesForOrg(
      Organization,
      OrgRole,
      org._id,
      PRESET_PERMISSIONS,
      DEFAULT_ROLE_NAMES,
    );
    const orgAdminRole = await OrgRole.findOne({
      organization: org._id,
      name: "Org Admin",
    });
    if (!orgAdminRole) {
      console.error("Org Admin role not found for org", org._id);
      process.exit(1);
    }

    await OrganizationMember.create({
      organization: org._id,
      user: user._id,
      role: orgAdminRole._id,
      status: "Active",
      joinedAt: new Date(),
    });

    created++;
    console.log(`  [${created}] ${user.email || user._id} -> org "${orgName}"`);
  }

  const finalOrgCount = await Organization.countDocuments({});
  const finalMemberCount = await OrganizationMember.countDocuments({});
  console.log(
    "\nMigration complete. Orgs created (one per user):",
    created,
    "| Users skipped (already in an org):",
    skipped,
  );
  console.log(
    "Verify in DB: organizations:",
    finalOrgCount,
    "| organizationmembers:",
    finalMemberCount,
  );
  if (created > 0 && (finalOrgCount === 0 || finalMemberCount === 0)) {
    console.warn(
      "Warning: expected documents not found after write. Check you are viewing database:",
      dbName,
      "in Compass.",
    );
  }
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
