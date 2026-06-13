import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    contactEmail: {
      type: String,
      required: [true, 'Contact email is required'],
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    },
    contactPhone: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Suspended'],
      default: 'Active',
    },
    logoUrl: { type: String, default: null },
    streamsCount: { type: Number, default: 0 },
    highlightsCount: { type: Number, default: 0 },
    // Soft delete fields – when true, org is treated as deleted
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: { type: String, default: "" },
    deletedIp: { type: String, default: "" },
    deletedCountry: { type: String, default: "UNKNOWN" },
    updatedBy: { type: String, default: "" },
    updatedIp: { type: String, default: "" },
    updatedCountry: { type: String, default: "UNKNOWN" },
  },
  { timestamps: true }
);

organizationSchema.index({ status: 1 });
organizationSchema.index({ isDeleted: 1 });
organizationSchema.index({ isDeleted: 1, deletedAt: 1 });
organizationSchema.index({ createdAt: -1 });
// Contact email must be unique across active organizations
organizationSchema.index(
  { contactEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

const Organization = mongoose.model('Organization', organizationSchema);
export default Organization;
