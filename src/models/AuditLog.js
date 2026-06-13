import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    requestId: { type: String, index: true },
    action: {
      type: String,
      enum: [
        "create",
        "update",
        "delete",
        "restore",
        "request",
        // Monitor: API failure, AI push, missing objects (background tracking)
        "api_failure",
        "ai_push",
        "missing_objects",
      ],
      required: true,
      index: true,
    },
    entity: { type: String, required: true, index: true },
    entityId: { type: String, required: false, index: true },
    actorId: { type: String, required: false, index: true },
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    method: { type: String },
    path: { type: String, index: true },
    statusCode: { type: Number, index: true },
    ip: { type: String, index: true },
    country: { type: String, index: true, default: "UNKNOWN" },
    userAgent: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: -1, orgId: 1 });
auditLogSchema.index({ action: 1, entity: 1, createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
