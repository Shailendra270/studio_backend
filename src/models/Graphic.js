import mongoose from 'mongoose';

const graphicSchema = new mongoose.Schema(
  {
    url: String,
    userId: { type: String, index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    folderId: { type: Array, default: [] },
    title: { type: String, default: '' },
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
graphicSchema.index({ organization: 1 });
graphicSchema.index({ organization: 1, isDeleted: 1, createdAt: -1 });
export default mongoose.model('Graphic', graphicSchema);