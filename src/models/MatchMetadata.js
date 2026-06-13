import mongoose from "mongoose";

/**
 * Cache for DSG match metadata used by Media Library enrichment.
 * Keyed by matchId; optionally store streamId/organization for scoping.
 */
const matchMetadataSchema = new mongoose.Schema(
  {
    matchId: { type: String, required: true, index: true },
    streamId: { type: String, default: "", index: true },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    category: { type: String, default: "" },
    /** Enriched payload: matchName, teams[], venue, competition, season, session, matchDay, score */
    payload: {
      matchName: { type: String, default: "" },
      matchDate: { type: String, default: "" },
      matchDay: { type: String, default: "" },
      teams: { type: [String], default: [] },
      venue: { type: String, default: "" },
      competition: { type: String, default: "" },
      season: { type: String, default: "" },
      session: { type: String, default: "" },
      scoreA: { type: Number, default: null },
      scoreB: { type: Number, default: null },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.model("MatchMetadata", matchMetadataSchema);
