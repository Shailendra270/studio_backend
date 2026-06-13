import mongoose from 'mongoose'

const VideoTemplateSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  name: { type: String, required: true },
  width: { type: Number },
  height: { type: Number },
  bitrate: { type: Number },
  bitrateMode: { type: String },
  fps: { type: Number },
  fpsMode: { type: String },
  region: { type: String },
  liveRegion: { type: String },
  streamingType: { type: String },
  fileType: { type: String },
  inputType: { type: String },
  templatePreset: { type: String },
  audioCodec: { type: String },
  multiAudio: { type: String },
  maxrate: { type: Number },
  bufsize: { type: Number },
  segmentDuration: { type: Number },
  playlistSize: { type: Number },
  audioBitrate: { type: String },
  srtMode: { type: String },
  srtPassphrase: { type: String },
  srtLatency: { type: Number },
  srtPeerLatency: { type: Number },
  srtRecvBuffer: { type: Number },
  srtSendBuffer: { type: Number },
  srtPacketDrop: { type: Number },
  srtPacketLatency: { type: Number },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: "" },
  deletedIp: { type: String, default: "" },
  deletedCountry: { type: String, default: "UNKNOWN" },
  updatedBy: { type: String, default: "" },
  updatedIp: { type: String, default: "" },
  updatedCountry: { type: String, default: "UNKNOWN" },
}, { timestamps: true })

VideoTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });
VideoTemplateSchema.index({ organization: 1 });
VideoTemplateSchema.index({ organization: 1, isDeleted: 1, createdAt: -1 });
export default mongoose.model('VideoTemplate', VideoTemplateSchema);
