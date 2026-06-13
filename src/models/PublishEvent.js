import mongoose from "mongoose";

const PublishEventSchema = new mongoose.Schema(
  {
    // id: { type: String, index: true, required: true },
    contentType: { type: String, default: "clip" },
    contentId: { type: String, index: true, required: true },
    // entityId: { type: String },
    platform: { type: String, required: true },
    type: { type: String, required: true },
    publisher: { type: String },
    publisherId: { type: String },
    profileKey: { type: String }, // Multi-tenant Ayrshare Profile Key
    status: { type: String, enum: ["pending", "completed", "failed", "scheduled", "rejected", "draft"], default: "pending" },
    initiatedAt: { type: Date, default: Date.now },
    publishedAt: { type: Date },
    scheduledAt: { type: Date },
    content: { type: Object, default: {} },
    aspectRatio: { type: String },
    streamId: { type: String },
    details: { type: Object, default: {} },
    publishFiles: { type: Array, default: [] },
    
    // Social Publishing Specifics
    ayrshareRefId: { type: String }, // Ayrshare internal reference
    platformPostId: { type: String }, // Actual platform ID (e.g., YouTube Video ID)
    postUrl: { type: String }, // Public URL to the post
    errorMessage: { type: String }, // Failure reason
    retryCount: { type: Number, default: 0 },
    ayrshareResponse: { type: Object }, // Store full response for debugging
  },
  { timestamps: true }
);

PublishEventSchema.index({ contentId: 1, createdAt: -1 });
PublishEventSchema.index({ platform: 1, type: 1, createdAt: -1 });

const PublishEvent = mongoose.model("PublishEvent", PublishEventSchema);
export default PublishEvent;

