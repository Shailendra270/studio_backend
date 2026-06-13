import mongoose from 'mongoose';
import moment from 'moment';

// Constants for enums
const Role = {
  ADMIN: 'admin',
  USER: 'user',
  REVIEWER: 'reviewer'
};

const ASPECT_RATIO = {
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:3': '4:3'
};

const SERVER_ADDRESS = 'default';
const ANALYSIS_SERVER = 'default';
const RECORDING_SERVER = 'default';

export const userSchema = new mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, required: true, ref: "Users" },
  role: { type: String, enum: Object.values(Role), required: true },
});

export const ClipTagStatus = {
  TAGGED: "tagged",
  UN_TAGGED: "unTagged",
  ALL: "all",
};

export const autoAspectRatioConvertSchema = new mongoose.Schema({
  autoConvertAspectRatios: [{ type: String, enum: Object.values(ASPECT_RATIO) }],
  for: { type: String, enum: Object.values(ClipTagStatus) },
});

export const customFieldsSchema = new mongoose.Schema(
  {
    clipCustomFields: [String], //  reference ID of the custom field from the org/ws collection
  },
  { _id: false },
);

const streamSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    type: { type: String, default: "" }, // either keymoment or highlight or ads_video
    isProduction: { type: Boolean, default: false },
    isLive: { type: Boolean, default: false },
    url: { type: String, default: "" },
    videoStreamMetaDataJson: { type: Array, default: [] },
    ruleId: [{ type: mongoose.Schema.Types.ObjectId, ref: "ruleconfiguration" }],
    clipRuleId: { type: String, default: "" },
    videoStreamLogsTxtUrl: { type: Array, default: [] },
    category: { type: String, default: "others" },
    // eslint-disable-next-line camelcase
    thumb_url: { type: String, default: "" },
    userId: { type: String },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    streamId: { type: String, required: true },
    createdDate: { type: String, default: "" }, //created date of record
    fileName: { type: String, default: "" },
    duration: { type: Number }, // in seconds
    size: { type: Number }, // in bytes
    exif: { type: Object, default: {} },
    status: { type: Number, default: 3 }, // 1 == completed, 2 == processing, 3 == pending ,4 == failed, 5 == cancelled,6 == delayed
    sortIndex: { type: Number, default: 0 }, // for sorting for processing the file
    fireOn: { type: String, default: "" },
    summaryTime: { type: String, default: "" },
    multiduration: { type: String, default: "" },
    inputVideoDuration: { type: Number, default: 0 },
    video_type: { type: String, default: "" },
    showId: { type: String, default: "" },
    reviewer: { type: String, default: "" },
    output_video: { type: Array, default: [] },
    rules: { type: Array, default: [] },
    // eslint-disable-next-line camelcase
    server_address: { type: String, default: SERVER_ADDRESS },
    analysis_server: { type: String, default: ANALYSIS_SERVER },
    // eslint-disable-next-line camelcase
    recording_server: { type: String, default: RECORDING_SERVER },
    fields: { type: Object, default: {} }, /// extra fields for videos
    config: { type: Object, default: {} }, // config of video
    // eslint-disable-next-line camelcase
    config_yml_path: { type: String, default: "" },
    // eslint-disable-next-line camelcase
    config_data: { type: Object, default: {} }, // data from ai machine
    durationEncoding: { type: Number, default: 0 },
    hlsS3URL: { type: String, default: "" },
    promoCreationCount: { type: Number, default: 1 },
    gameDate: { type: Date, default: moment().format() },
    // eslint-disable-next-line camelcase
    setCustomVideos: { type: Array, default: [] },
    yugenHighlightURL: { type: Array, default: [] },
    createdBy: { type: String, default: "" },
    sqsId: { type: mongoose.Schema.ObjectId, ref: "SqsService" },
    projectName: { type: String, default: "" },
    isMute: { type: Boolean, default: false },
    datafeed: { type: Object, default: {} },
    vod: { type: Boolean, default: false },
    messageId: { type: String, default: "" },
    joinedFileKey: { type: String, default: "" },
    joinedFileUpdateKey: { type: String, default: "" },
    dataStoreFolderPath: { type: String, default: "" },
    tags: { type: String, default: "" },
    // processingDate: { type: String },
    isAiTaken: { type: Boolean, default: false },
    storageName: { type: String, default: "" },
    storageId: { type: mongoose.Types.ObjectId, default: null },
    onAirDate: { type: Date, default: moment().format() },
    onAirDatetimesteamp: { type: Number, default: 0 },
    aiTATForClip: { type: Number, default: 0 },
    clientStatus: { type: String, default: "processing" },
    processingCompletedDate: { type: String, default: "" },
    processingDate: { type: String, default: "" },
    aws_alb: { type: String, default: "" },
    recording_aws_alb: { type: String, default: "" },
    isAutoCancelled: { type: Boolean, default: false },
    processStartTimeInQueue: { type: Date },
    processCompleteProgress: { type: Number, default: 0 },
    processingDuration: { type: Number, default: 0 }, // In seconds
    processingStorage: { type: Number, default: 0 }, // In bytes
    highlightConsumption: {
      highlightStorage: { type: Number, default: 0 },
      highlightTime: { type: Number, default: 0 },
    },
    isAiZeeTakenFromQueue: { type: Boolean, default: false },
    glacierRecoveredStream: { type: Boolean, default: false },
    enhanced_clips_replace: { type: Boolean, default: false },
    multiAudioInStream: { type: Boolean, default: false },
    // Store team shortids
    team1Id: { type: String, default: "" },
    team2Id: { type: String, default: "" },
    // Store competition shortid
    tournamentId: { type: String, default: "" },
    matchId: { type: String, default: "" },
    matchDate: { type: Date },
    videoTemplateId: { type: String, default: "" },
    streamLanguage: { type: String, default: "" },
    streamBitrate: { type: Number, default: 6 },
    audioIndex: { type: String, default: "" },
    videoIndex: { type: String, default: "" },
    autoIndexAudioVideo: { type: Boolean, default: true },
    sizeEncoded: { type: Number, default: 0 },
    add_video: { type: String, default: "" },
    reviewersId: { type: Array, default: [] },
    referenceStream: { type: String, default: "" },
    customSports: { type: Array, default: [] },
    sqsLiveCutResponce: { type: Array, default: [] },
    content_analysis_details: { type: Boolean, default: false },
    ftp_url: { type: String, default: "" },
    ftp_hlsS3URL: { type: String, default: "" },
    ftp_s3RecordedUrl: { type: String, default: "" },
    s3RecordedUrl: { type: String, default: "" },
    jobId: { type: String, default: "" },
    clipFolderCount: { type: Number, default: 0 },
    matchMappingKey: { type: String, default: "" },
    enable_vertical: { type: Boolean, default: false },
    tournament_type: { type: String },
    ftpUpdate: { type: Boolean, default: false },
    auto_scale_pick_status: { type: Boolean, default: false },
    jsonTemplate: { type: Object, default: {} },
    jsonTemplateId: { type: mongoose.Schema.ObjectId, ref: "json_templates" },
    streamRecordedVideoUrl: { type: String, default: "" },
    endDateTime: { type: String, default: "" },
    seiEnable: { type: Boolean, default: false },
    matchNumber: { type: String, default: "" },
    jsonClipPublishCount: {
      type: [{ type: mongoose.Schema.ObjectId, ref: "sonypayloads" }],
      default: [],
    },
    isManualCompleted: { type: Boolean, default: false },
    streamCheckCount: { type: Number, default: 0 },
    reFireStreamCount: { type: Number, default: 0 },
    reFireRefStream: { type: String },
    streamStartTime: { type: Date },
    streamEndTime: { type: Date },
    markCompleteTime: { type: Date },
    isStreamRefire: { type: Boolean, default: false },
    aiCompletionIndicator: { type: Boolean, default: false },
    isCopiedStream: { type: Boolean, default: false },
    copyStreamId: { type: String, default: "" }, //id of copied stream
    storyStorageId: { type: mongoose.Schema.ObjectId }, // reference id of default story storage
    matrix_event_id: { type: String, default: "" }, //ref id of matrix event thread (matricesevent)
    aspectRatio: { type: String, default: "16:9" }, // aspectratio of the video
    resolution: { type: Object, default: {} },
    allowClipRating: { type: Boolean, default: false }, // Allow Clip rating to the clips
    allowAutoRating: { type: Boolean, default: false }, // Allow auto rating to the clips
    isAutoTitle: { type: Boolean }, // For auto generating Ai Title
    match_start_time_on_server: { type: Number, default: 0.0 },
    videoInputQuality: { type: String, default: "" },
    videoOutputQuality: { type: String, default: "" },
    previousRecordingURLs: { type: Array, default: [] },
    downloadedClipCount: { type: Number, default: 0 },
    highlightsCount: { type: Number, default: 0 },
    highlightPublishCount: { type: Number, default: 0 },
    downloadedHighlightCount: { type: Number, default: 0 },
    clipPublishCount: { type: Number, default: 0 },
    clipsCount: { type: Number, default: 0 },
    matchType: { type: String, default: "" },
    inputFile: { type: String },
    limitation: { type: Object }, // an object to hold the user's allowable limits.
    isGlacierStatus: { type: Boolean, default: false },
    mediaLiveConfig: { type: Object }, // if media live stream added
    isMediaLive: { type: Boolean }, // if media live stream added
    mediaLiveInputId: { type: String }, // media live input id
    mediaLivechannelId: { type: String }, // media live channel id
    outputTemplateId: { type: String }, // media live
    flow_id: { type: String, default: "" }, // medialive flow id
    source_arn: { type: String, default: "" }, // medeia live source arn
    hlsToMp4Convert: { type: Boolean, default: false },
    hls_live_start_index: { type: Number, default: 1 }, // grabyo hls live start index value, this value coming from grabyo team
    matchStartTimeOnServer: { type: Number, default: 0 }, // timestamp whenever the stream gets processed on AI server
    initialMatchStartTimeOnServer: { type: Number, immutable: true, default: 0 }, // timestamp whenever the stream gets processed on AI server at first
    env: { type: String, default: "" },
    publishingWebhookUrl: { type: String, default: "" }, // for Grabyo
    ymlFireTime: { type: Date }, // yml serve fire time
    enableStreamReplay: { type: Boolean, default: false }, // for enabling stream replay

    // below keys are added for tenant implementation
    // entityId: { type: String, default: "default-entity" }, //organizationId/workspaceId to which stream belong to
    isExclusiveSharing: { type: Boolean, default: false }, //defines orginal/copy sharing stream,
    streamAccess: { type: String, default: "" },
    sharedWorkspaces: { type: Array, default: [] }, //selected workspaces if parent stream
    categoryId: { type: mongoose.Types.ObjectId, default: null }, // use categoryId instead of category for new implementations
    enhanceAutoflipBitrate: { type: Boolean, default: false }, //allows enhance bitrate for autoflip requests
    defaultThumbnailUrl: { type: String, default: "" },
    playlist_url: { type: String, default: "" },
    autoAspectRatioConvert: autoAspectRatioConvertSchema,
    clipNamingTemplateId: { type: String },
    playStream: { type: Boolean, default: false },
    autoProcessAI: { type: Boolean, default: false }, // will be true if stream is auto picked && processed on AI server
    source: { type: String, default: "" }, // source from where stream is added e.g [ partner_service , api_service ]
    customFields: {
      type: customFieldsSchema,
      default: null,
    },
    // language: { type: String, default: "" }, // Removed due to MongoDB language override conflict
    hasEndListTag: { type: Boolean, default: false }, // tracks if #EXT-X-ENDLIST tag is present in manifest
    
    // Additional fields for zentag_backend_
    videoType: { type: String, default: "" },
    competitionType: { type: String, default: "" },
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

// Indexes for performance
streamSchema.index({ streamId: 1 });
streamSchema.index({ category: 1 });
streamSchema.index({ url: 1 });
streamSchema.index({ sqsId: 1 });
streamSchema.index({ status: 1 });
streamSchema.index({ joinedFileKey: 1 });
streamSchema.index({ messageId: 1 });
streamSchema.index({ processingDate: 1 });
streamSchema.index({ createdAt: 1 });
streamSchema.index({ userId: 1 });
streamSchema.index({ organization: 1 });
streamSchema.index({ type: 1 });
// streamSchema.index({ entityId: 1 });
streamSchema.index({ inputFile: 1 });
streamSchema.index(
  {
    // entityId: 1,
    sharedWorkspaces: 1,
    isExclusiveSharing: 1,
    status: 1,
  },
  { name: "entity_workspace_status_idx" },
);
streamSchema.index({ sharedWorkspaces: 1, isExclusiveSharing: 1 });
streamSchema.index({
  // entityId: 1,
  "fields.fileName": "text",
  title: "text",
  joinedFileKey: "text",
});

const Stream = mongoose.model('Stream', streamSchema);

export default Stream;
