/**
 * One-off: Set user info@zentag.ai as superadmin and remove their organization.
 * - Sets user.role = 'superadmin'
 * - Deletes all OrganizationMember for this user
 * - Deletes OrgRole and Organization for each org that was linked to this user
 *
 * Run: npm run script:set-superadmin-no-org  (from backend root)
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from root .env
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGO_URI;
const SUPERADMIN_EMAIL = "info@zentag.ai";

async function run() {
  await mongoose.connect(MONGO_URI);
  const dbName = mongoose.connection.db?.databaseName || "unknown";
  console.log("Connected to MongoDB, database:", dbName);

  const User = (await import("../src/models/User.js")).default;
  const OrganizationMember = (
    await import("../src/models/OrganizationMember.js")
  ).default;
  const OrgRole = (await import("../src/models/OrgRole.js")).default;
  const Organization = (await import("../src/models/Organization.js")).default;

  const user = await User.findOne({
    email: SUPERADMIN_EMAIL.toLowerCase().trim(),
  });
  if (!user) {
    console.error("User not found with email:", SUPERADMIN_EMAIL);
    await mongoose.disconnect();
    process.exit(1);
  }

  const memberships = await OrganizationMember.find({ user: user._id })
    .select("organization")
    .lean();
  const orgIds = [
    ...new Set(
      memberships.map((m) => m.organization?.toString()).filter(Boolean),
    ),
  ];

  console.log("User:", user.email, "(_id:", user._id.toString() + ")");
  console.log("Current role:", user.role);
  console.log("Organization memberships to remove:", memberships.length);
  console.log("Organizations to delete:", orgIds.length, orgIds);

  // 1) Set superadmin
  await User.updateOne({ _id: user._id }, { $set: { role: "superadmin" } });
  console.log("Set role to superadmin.");

  // 2) Delete this user's organization memberships
  const delMembers = await OrganizationMember.deleteMany({ user: user._id });
  console.log("Deleted organization members:", delMembers.deletedCount);

  // 3) For each org: delete OrgRoles then Organization
  for (const orgId of orgIds) {
    const delRoles = await OrgRole.deleteMany({ organization: orgId });
    const delOrg = await Organization.deleteOne({ _id: orgId });
    console.log(
      "Org",
      orgId,
      "- deleted roles:",
      delRoles.deletedCount,
      "| deleted org:",
      delOrg.deletedCount,
    );
  }

  console.log(
    "\nDone. User",
    SUPERADMIN_EMAIL,
    "is now superadmin with no organization.",
  );
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
