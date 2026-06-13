import mongoose from 'mongoose';
import shortid from 'shortid';

const socialProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Unique ID from Ayrshare or internal ID
  id: { 
    type: String, 
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'archived'],
    default: 'active'
  },
  provider: {
    type: String,
    default: 'ayrshare'
  },
  // Ayrshare specific data
  profileKey: {
    type: String,
    required: true
  },
  refId: {
    type: String
  },
  profileId: {
    type: String
  },
  // Store the full raw response for future reference
  rawResponse: {
    type: Object
  },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: "" },
  deletedIp: { type: String, default: "" },
  deletedCountry: { type: String, default: "UNKNOWN" },
  updatedBy: { type: String, default: "" },
  updatedIp: { type: String, default: "" },
  updatedCountry: { type: String, default: "UNKNOWN" },
}, {
  timestamps: true
});

// Indexes
socialProfileSchema.index({ userId: 1 });
socialProfileSchema.index({ profileKey: 1 });
socialProfileSchema.index({ userId: 1, isDeleted: 1, createdAt: -1 });

const SocialProfile = mongoose.model('SocialProfile', socialProfileSchema);

export default SocialProfile;
