import mongoose from 'mongoose';

const organizationMemberSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrgRole',
      required: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Invited'],
      default: 'Active',
    },
    invitedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: Date.now },
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

organizationMemberSchema.index({ organization: 1, user: 1 }, { unique: true });
organizationMemberSchema.index({ user: 1 });
organizationMemberSchema.index({ organization: 1 });
organizationMemberSchema.index({ organization: 1, isDeleted: 1 });

const OrganizationMember = mongoose.model('OrganizationMember', organizationMemberSchema);
export default OrganizationMember;
