import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['system', 'user', 'assistant', 'tool'],
      required: true,
    },
    content: { type: String, required: true },
    name: { type: String, default: '' },
    toolCallId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const chatThreadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    title: { type: String, default: '' },
    messages: { type: [chatMessageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

chatThreadSchema.index({ user: 1, lastMessageAt: -1 });
chatThreadSchema.index({ orgId: 1, lastMessageAt: -1 });

export default mongoose.model('ChatThread', chatThreadSchema);
