import mongoose from 'mongoose';

// Permissions: Record<Module, Record<Action, boolean>> - stored as Mixed/Object
const orgRoleSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Role name is required'],
      trim: true,
      maxlength: [50, 'Role name cannot exceed 50 characters'],
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: "" },
    deletedIp: { type: String, default: "" },
    deletedCountry: { type: String, default: "UNKNOWN" },
    updatedBy: { type: String, default: "" },
    updatedIp: { type: String, default: "" },
    updatedCountry: { type: String, default: "UNKNOWN" },
  },
  { timestamps: true }
);

orgRoleSchema.index({ organization: 1, name: 1 }, { unique: true });

const OrgRole = mongoose.model('OrgRole', orgRoleSchema);
export default OrgRole;
