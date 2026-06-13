import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    // enum: ['cricket', 'football', 'basketball', 'tennis', 'hockey', 'handball', 'netball', 'rugby_sevens', 'other']
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  tagType: {
    type: String,
    required: true,
    enum: ['event', 'player']
  },
  isDatafeed:{
    type: Boolean,
    default: false
  },
  createdBy: {
    type: String,
    required: true
  },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  isSynced: {
    type: Boolean,
    default: false
  },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: "" },
  deletedIp: { type: String, default: "" },
  deletedCountry: { type: String, default: "UNKNOWN" },
  updatedBy: { type: String, default: "" },
  updatedIp: { type: String, default: "" },
  updatedCountry: { type: String, default: "UNKNOWN" },



  
  metaData: {
    isSynced: { type: Boolean, default: false },
    playerName: { type: String, default: undefined },
    jerseyNumber: { type: String, default: undefined },
    nationality: { type: String, default: undefined },
    peopleId: { type: String, index: true, default: undefined },
    teamId: { type: String, default: undefined },
    seasonId: { type: String, default: undefined },
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for efficient queries
tagSchema.index({ category: 1, tagType: 1 });
// tagSchema.index({ category: 1, tagType: 1, streamId: 1 });
tagSchema.index({ createdBy: 1 });
tagSchema.index({ organization: 1 });
tagSchema.index({ organization: 1, isDeleted: 1, createdAt: -1 });

// Ensure unique tags per category and type
// Removed legacy unique index on player name+streamId to avoid conflicts across teams

tagSchema.index(
  { createdBy: 1, category: 1, name: 1, tagType: 1 },
  { 
    unique: true,
    partialFilterExpression: { tagType: 'event' }
  }
);

// Unique player per user/category/peopleId/tagType
tagSchema.index(
  { createdBy: 1, category: 1, tagType: 1, 'metaData.peopleId': 1 },
  {
    unique: true,
    partialFilterExpression: { tagType: 'player' }
  }
);

// Virtual populate to fetch creator user details by matching userId
tagSchema.virtual('creator', {
  ref: 'User',
  localField: 'createdBy',
  foreignField: 'userId',
  justOne: true
});

// Attempt to drop legacy global unique index to allow per-user event tag duplicates
try {
  const conn = mongoose.connection;
  // If connection is ready, drop legacy index; otherwise schedule after open
  if (conn && conn.readyState === 1) {
    conn.db.collection('tags').dropIndex('category_1_name_1_tagType_1').catch(() => {});
  } else {
    conn.once('open', () => {
      conn.db.collection('tags').dropIndex('category_1_name_1_tagType_1').catch(() => {});
    });
  }
} catch (e) {
  // ignore
}

export default mongoose.model('Tag', tagSchema);
