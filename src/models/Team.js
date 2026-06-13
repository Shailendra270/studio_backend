import mongoose from "mongoose";

// Team model updated to include a short string `id` and `userId`
const teamSchema = new mongoose.Schema(
  {
    // Short unique identifier separate from Mongo _id
    id: { type: String, required: true, unique: true },
    // Owner of the team
    userId: { type: String, required: true, index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    seasonId: { type: String, required: false, index: true },
    name: { type: String, required: true, trim: true },
    playerIds: { type: [String], required: true, default: [] },
    isSynced: { type: Boolean, default: false },
    players: [
      {
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Tag",
          required: false,
        },
        name: { type: String },
      },
    ],
    category: { type: String, required: true },
    isDatafeed: { type: Boolean, default: false },
    team_id: { type: String, default: "" }, // dsg team_id
    teamImages: [
      {
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Asset",
          required: false,
        },
        type: {
          type: String,
          enum: ["team_logo", "full_image"],
          default: "team_logo",
        },
        url: { type: String },
        name: { type: String },
      },
    ],
    country: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: "" },
    deletedIp: { type: String, default: "" },
    deletedCountry: { type: String, default: "UNKNOWN" },
    updatedBy: { type: String, default: "" },
    updatedIp: { type: String, default: "" },
    updatedCountry: { type: String, default: "UNKNOWN" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Index to optimize queries by owner, category and name
teamSchema.index({ userId: 1, seasonId: 1, category: 1, name: 1 }, { unique: false });
teamSchema.index({ organization: 1 });
teamSchema.index({ userId: 1, externalId: 1 }, { unique: false });
teamSchema.index({ organization: 1, isDeleted: 1, createdAt: -1 });

export default mongoose.model("Team", teamSchema);
