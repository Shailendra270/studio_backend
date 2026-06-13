import mongoose from "mongoose";

const RecipientSchema = new mongoose.Schema(
  {
    address: { type: String, required: true },
    type: { type: String, enum: ["to", "cc", "bcc"], required: true },
    status: { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
    deliveryTimestamp: { type: Date },
    errorMessage: { type: String },
  },
  { _id: false }
);

const AttachmentSchema = new mongoose.Schema(
  {
    fileName: String,
    mimeType: String,
    size: Number,
    storageUrl: String,
  },
  { _id: false }
);

const ClipDetailsSchema = new mongoose.Schema(
  {
    clipId: { type: String },
    clipType: { type: String },
    duration: { type: Number },
    referenceUrl: { type: String },
    aspectRatio: { type: String },
  },
  { _id: false }
);

const EmailHistorySchema = new mongoose.Schema(
  {
    emailId: { type: String, index: true, required: true },
    userId: { type: String, index: true },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    subject: { type: String },
    html: { type: String },
    text: { type: String },
    attachments: { type: [AttachmentSchema], default: [] },
    recipients: { type: [RecipientSchema], default: [] },
    clip: { type: ClipDetailsSchema, default: {} },
    provider: { type: String, enum: ["ses", "sendgrid", "smtp"], default: "smtp" },
    status: { type: String, enum: ["PENDING", "SENT", "FAILED", "RETRYING"], default: "PENDING" },
    errorMessage: { type: String },
    retryCount: { type: Number, default: 0 },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

EmailHistorySchema.index({ userId: 1, createdAt: -1 });
EmailHistorySchema.index({ status: 1, createdAt: -1 });

const EmailHistory = mongoose.model("EmailHistory", EmailHistorySchema);
export default EmailHistory;

