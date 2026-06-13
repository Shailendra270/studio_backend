import mongoose from 'mongoose';

const clipList = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    clips: [{ type: mongoose.Schema.Types.ObjectId, ref: "Clip" }],
    title: { type: String, default: "", required: true },
    streamId: { type: String, default: null },
    generationMetadata: {
      trimmed: { type: Boolean, default: false },
      trimmingDoneBy: {
        type: String,
        enum: ["MANUAL", "AUTO", "AI"],
        default: "MANUAL",
      },
    },
    aspectRatio: { type: String },
    category: { type: String },
    previewUrl: { type: String },
    isPreview: { type: Boolean, default: false },
    thumbnail: { type: String, default: "" },
    thumbnails: { type: Array, default: [] },
    socialMediaInfoArray: { type: Array, default: [] },
    previewData: { type: Object, default: {} },
    highlightPublishCount: { type: Number, default: 0 },
    csvData: { type: Object, default: {} },
    timeTaken: { type: Number, default: 0 },
    timeTakenHLQ: { type: Number, default: 0 },
    timeTakenHLAI: { type: Number, default: 0 },
    type: { type: String, default: "" },
    csvUrl: { type: String, default: "" },
    ruleId: { type: mongoose.Schema.Types.ObjectId, ref: "ruleconfiguration" },
    progressPercent: { type: Number },
    storageConsumed: { type: Number, default: 0 },
    clipPublished: { type: Array },
    lastPublishedDate: { type: String },
    isGlacierStatus: { type: Boolean, default: false },
    rating: { type: Number, default: 0 },
    tags: { type: Array, default: [] },
    reasonForRating: { type: String, default: "" },
    downloadedClipCount: { type: Number, default: 0 },
    totalDurationWithoutBumper: { type: Number, default: 0 },
    clientPayload: { type: Object, default: null },
    automationIdentifier: { type: String },
    batchId: { type: String, default: null },
    // Indicates folder was initiated via AI highlight flow
    isAiCreated: { type: Boolean, default: false },
    // AI server port for highlight generation
    aiServerPort: { type: Number, default: null },
    // Highlight generation fields
    highlightInitiatedAt: { type: Date },
    isHighlightVideo: { type: Boolean, default: false },
    status: { type: String, default: "draft" },
    totalDuration: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: "" },
    deletedIp: { type: String, default: "" },
    deletedCountry: { type: String, default: "UNKNOWN" },
    updatedBy: { type: String, default: "" },
    updatedIp: { type: String, default: "" },
    updatedCountry: { type: String, default: "UNKNOWN" },
  },
  { timestamps: true },
);

// Create indexes for better performance
clipList.index({ clips: 1 });
clipList.index({ clips: 1, streamId: 1 });
clipList.index({ streamId: 1, title: 1, type: 1 }, { unique: true, sparse: true });
clipList.index({ automationIdentifier: 1 }, { sparse: true });
clipList.index({
  rating: 1,
});
clipList.index({
  tags: 1,
});
clipList.index({
  category: 1,
});
clipList.index({ streamId: 1, createdAt: -1 });
clipList.index({ organization: 1 });
clipList.index({ organization: 1, type: 1 }); // media-library stats (highlights)
clipList.index({ organization: 1, type: 1, createdAt: -1 }); // media-library list "All" by date
clipList.index({ organization: 1, isDeleted: 1, createdAt: -1 });
clipList.index({ status: 1 });
clipList.index({
  aspectRatio: 1,
});
// Ensure indexes are created when the model is loaded
clipList.set('autoIndex', true);

export default mongoose.model('clipList', clipList);