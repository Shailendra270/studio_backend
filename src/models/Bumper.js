import mongoose from 'mongoose';

const bumperSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    url: { type: String, default: '' },
    webmUrl: { type: String, default: '' },
    type: { type: String, default: '' }, // 'video' for bumpers, 'mov' for overlays
    aspectRatio: { type: String, default: '' },
    userId: { type: String, index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    duration: { type: Number, default: 0 },
    // delay: { type: Number, default: 0 },
    folderId: { type: Array, default: [] },
    format: { type: String, default: '' },
    contentType: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: '' },
    deletedIp: { type: String, default: '' },
    deletedCountry: { type: String, default: 'UNKNOWN' },
    updatedBy: { type: String, default: '' },
    updatedIp: { type: String, default: '' },
    updatedCountry: { type: String, default: 'UNKNOWN' },
  },
  { timestamps: true }
);
bumperSchema.index({ organization: 1 });
bumperSchema.index({ organization: 1, isDeleted: 1, createdAt: -1 });
export default mongoose.model('Bumper', bumperSchema);
