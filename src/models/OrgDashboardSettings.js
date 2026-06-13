import mongoose from 'mongoose';

/**
 * Per-organization dashboard UI settings (e.g. which filter chips are visible).
 * One document per organization; created on first save.
 */
const orgDashboardSettingsSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    /** Filter IDs to show in the dashboard filter bar (e.g. streams, seasons, competition, players) */
    visibleFilters: {
      type: [String],
      default: [],
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

orgDashboardSettingsSchema.index({ organization: 1 });

export default mongoose.model('OrgDashboardSettings', orgDashboardSettingsSchema);
