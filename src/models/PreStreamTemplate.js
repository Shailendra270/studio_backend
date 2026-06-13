import mongoose from 'mongoose'

const PreStreamTemplateSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  createdBy: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String },
  videoTemplateId: { type: String },
  analysisServer: { type: String },
  recordingServer: { type: String },
  storage: { type: String },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: "" },
  deletedIp: { type: String, default: "" },
  deletedCountry: { type: String, default: "UNKNOWN" },
  updatedBy: { type: String, default: "" },
  updatedIp: { type: String, default: "" },
  updatedCountry: { type: String, default: "UNKNOWN" },
}, { timestamps: true })

PreStreamTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });
PreStreamTemplateSchema.index({ organization: 1 });
PreStreamTemplateSchema.index({ organization: 1, isDeleted: 1, createdAt: -1 });
export default mongoose.model('PreStreamTemplate', PreStreamTemplateSchema);

