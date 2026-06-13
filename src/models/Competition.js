import mongoose from 'mongoose';

const competitionSchema = new mongoose.Schema(
  {
    // Short unique id for competition
    id: { type: String },
    name: { type: String, required: true, trim: true }, // original_name
    title: { type: String, default: "" },
    category: { type: String, required: true }, // sport / discipline.name
    // Owner scoping
    userId: { type: String },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    // Datafeed fields
    isDatafeed: { type: Boolean, default: false },
    competitionId: { type: String, default: "" }, // competition_id
    seasonId: { type: String, default: "" }, // season_id
    logo: { type: String, default: "" },
    country: { type: String, default: "" }, // area_name
    gender: { type: String, default: "" },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    teamIds: [{ type: String, default: "" }], // Array of teamIds
    // Store team details
    teams: [
      {
        teamId: { type: String, required: true }, // shortid
        name: { type: String, required: true },
      }
    ],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: '' },
    deletedIp: { type: String, default: '' },
    deletedCountry: { type: String, default: 'UNKNOWN' },
    updatedBy: { type: String, default: '' },
    updatedIp: { type: String, default: '' },
    updatedCountry: { type: String, default: 'UNKNOWN' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

competitionSchema.index({ category: 1, name: 1 }, { unique: false });
competitionSchema.index({ userId: 1 });
competitionSchema.index({ id: 1 }, { unique: true });
competitionSchema.index({ userId: 1, seasonId: 1 }, { unique: false });
competitionSchema.index({ organization: 1 });
competitionSchema.index({ organization: 1, isDeleted: 1, createdAt: -1 });

export default mongoose.model('Competition', competitionSchema);
