import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";
import moment from "moment";
import path from "path";
import mongoose from "mongoose";
import Stream from "../models/Stream.js";
import Clip from "../models/Clip.js";
import Folder from "../models/Folder.js";
import logger from "../utils/logger.js";
import shortid from "shortid";
import axios from "axios";
import PreStreamTemplate from "../models/PreStreamTemplate.js";
import VideoTemplate from "../models/VideoTemplate.js";
import { getCurrentUserOrgId } from "../utils/organizationHelper.js";
import MatchMetadata from "../models/MatchMetadata.js";
import { fetchAndParseMatchMetadata } from "../services/dsgMatchService.js";
import { activeFilter } from "../utils/softDelete.js";
import { getAuditStamp, getSoftDeleteStamp } from "../utils/requestContext.js";
import { buildBaseAuditFromRequest, writeAuditLog } from "../services/auditLogService.js";

// Configure Google Cloud Storage
const storage = new Storage({
  keyFilename: path.join(process.cwd(), "env_config/gcp-service-account.json"),
  projectId: "zeta-envoy-462108-b8",
});

const BUCKET_NAME = "gcp-mulistream-dev";
const BUCKET_REGION = "asia-south1";
const STORAGE_ENDPOINT = "https://storage.googleapis.com";
const STREAMS_FOLDER = "streams_data/";

const bucket = storage.bucket(BUCKET_NAME);

/**
 * Generate a signed URL for file upload to GCP Cloud Storage
 * @param {string} fileName - The name of the file
 * @param {string} contentType - The MIME type of the file
 * @returns {Promise<string>} - The signed URL for upload
 */
const generateUploadUrl = async (fileName, contentType = "video/mp4") => {
  const file = bucket.file(`${STREAMS_FOLDER}${fileName}`);

  const options = {
    version: "v4",
    action: "write",
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    contentType: contentType,
  };

  const [url] = await file.getSignedUrl(options);
  return url;
};

/**
 * Generate a public URL for accessing a file in GCP Cloud Storage
 * @param {string} fileName - The name of the file
 * @returns {string} - The public URL
 */
const generatePublicUrl = (fileName) => {
  return `${STORAGE_ENDPOINT}/${BUCKET_NAME}/${STREAMS_FOLDER}${fileName}`;
};

/**
 * Check if a file exists in GCP Cloud Storage
 * @param {string} fileName - The name of the file
 * @returns {Promise<boolean>} - Whether the file exists
 */
const fileExists = async (fileName) => {
  const file = bucket.file(`${STREAMS_FOLDER}${fileName}`);
  const [exists] = await file.exists();
  return exists;
};

// Storage configuration for compatibility
const STORAGE_CONFIG = {
  bucketName: BUCKET_NAME,
  region: BUCKET_REGION,
  endpoint: STORAGE_ENDPOINT,
  projectId: "zeta-envoy-462108-b8",
  streamsFolder: STREAMS_FOLDER,
};

const MATCH_METADATA_SYNC_ATTEMPTS = 2;

function normalizeDsgCategory(category) {
  return (category || "others") === "football" ? "soccer" : category || "others";
}

function isMatchMetadataPayloadIncomplete(payload) {
  const teams = Array.isArray(payload?.teams) ? payload.teams.filter(Boolean) : [];
  return (
    !String(payload?.matchName || "").trim() ||
    !String(payload?.competition || "").trim() ||
    !String(payload?.session || "").trim() ||
    teams.length === 0
  );
}

async function syncMatchMetadataCache({
  matchId,
  streamId,
  organization,
  category,
}) {
  const normalizedMatchId = String(matchId || "").trim();
  if (!normalizedMatchId) return;

  const normalizedCategory = normalizeDsgCategory(category);
  const existingDoc = await MatchMetadata.findOne({ matchId: normalizedMatchId })
    .select("payload")
    .lean();

  if (existingDoc && !isMatchMetadataPayloadIncomplete(existingDoc.payload)) {
    await MatchMetadata.findOneAndUpdate(
      { matchId: normalizedMatchId },
      {
        $set: {
          streamId: streamId || "",
          organization: organization || undefined,
          category: category || "",
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
    return;
  }

  let payload = existingDoc?.payload || {};
  for (let attempt = 1; attempt <= MATCH_METADATA_SYNC_ATTEMPTS; attempt += 1) {
    payload = await fetchAndParseMatchMetadata(normalizedMatchId, normalizedCategory);
    if (!isMatchMetadataPayloadIncomplete(payload)) break;
    logger.warn(
      `Match metadata incomplete for ${normalizedMatchId} on attempt ${attempt}/${MATCH_METADATA_SYNC_ATTEMPTS}`,
    );
  }

  await MatchMetadata.findOneAndUpdate(
    { matchId: normalizedMatchId },
    {
      $set: {
        streamId: streamId || "",
        organization: organization || undefined,
        category: category || "",
        payload,
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
}

/**
 * Create a new stream
 * @route POST /api/streams/create
 * @access Private
 */
export const createStream = async (req, res) => {
  try {
    const {
      title,
      url,
      category,
      userId,
      createdBy,
      createdAt,
      server_address = "default",
      recording_server = "default",
      clipsCount = 0,
      gameDate,
      isLive = false,
      videoType,
      competitionType,
      // new fields for teams and tournament
      team1Id,
      team2Id,
      tournamentId,
      matchId,
      matchDate,
      // language = '' // Removed due to MongoDB language override conflict
    } = req.body;

    const rawVideoTemplateId = String(
        req.body?.videoTemplateId ||
        req.body?.metadata?.videoTemplateId ||
        ""
    ).trim();
    const rawStreamLanguage =
      String(req.body?.streamLanguage || req.body?.metadata?.streamLanguage || "").trim();

    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    const resolveMatchDate = () => {
      const direct = matchDate ?? metadata?.matchDate;
      if (direct) {
        const d = new Date(direct);
        if (!Number.isNaN(d.getTime())) return d;
      }

      const dateStr = typeof metadata?.date === "string" ? metadata.date.trim() : "";
      if (!dateStr) return undefined;

      const dateMoment = moment.utc(dateStr, ["DD.MM.YY", "DD.MM.YYYY", moment.ISO_8601], true);
      if (!dateMoment.isValid()) return undefined;

      const hourStr = typeof metadata?.time === "string" ? metadata.time.trim() : "";
      const minuteStr = typeof metadata?.timeMinutes === "string" ? metadata.timeMinutes.trim() : "";
      const amPm = typeof metadata?.amPm === "string" ? metadata.amPm.trim().toUpperCase() : "";

      const hasTime = /^\d{1,2}$/.test(hourStr) && /^\d{1,2}$/.test(minuteStr) && (amPm === "AM" || amPm === "PM");
      if (!hasTime) return dateMoment.startOf("day").toDate();

      const hourNum = parseInt(hourStr, 10);
      const minuteNum = parseInt(minuteStr, 10);
      if (Number.isNaN(hourNum) || Number.isNaN(minuteNum) || hourNum < 0 || hourNum > 12 || minuteNum < 0 || minuteNum > 59) {
        return dateMoment.startOf("day").toDate();
      }

      let hour24 = hourNum % 12;
      if (amPm === "PM") hour24 += 12;
      return dateMoment.hour(hour24).minute(minuteNum).second(0).millisecond(0).toDate();
    };
      
    const resolvedMatchDate = resolveMatchDate();
    // Validation
    if (!title || !url || !userId) {
      return res.status(400).json({
        status: "error",
        message: "Title, URL, and userId are required fields",
      });
    }

    // Generate unique streamId and file names
    const streamId = shortid.generate();
    const fileName = `${streamId}_${Date.now()}.mp4`;
    const thumbnailName = `${streamId}_thumbnail.jpg`;

    // Generate GCP storage URLs
    let uploadUrl = null;
    let publicUrl = null;

    try {
      uploadUrl = await generateUploadUrl(fileName);
      publicUrl = generatePublicUrl(fileName);
    } catch (storageError) {
      logger.error("Error generating storage URLs:", storageError);
      // Continue without upload URL - can be generated later if needed
    }

    const organizationId = await getCurrentUserOrgId(req);

    // Create stream data object
    const streamData = {
      title,
      url,
      category: category || "others",
      userId,
      ...(organizationId && { organization: organizationId }),
      streamId,
      createdBy: createdBy || userId,
      createdDate: createdAt || moment().format(),
      server_address,
      recording_server,
      clipsCount,
      gameDate: gameDate || moment().format(),
      isLive,
      videoType: videoType || "",
      competitionType: competitionType || "",
      // teams and tournament references
      team1Id: team1Id || "",
      team2Id: team2Id || "",
      tournamentId: tournamentId || "",
      matchId: matchId || "",
      matchDate: resolvedMatchDate,
      videoTemplateId: rawVideoTemplateId,
      streamLanguage: rawStreamLanguage,
      // language: language || null, // Removed due to MongoDB language override conflict

      // Default values for required fields
      entityId: userId, // Using userId as entityId for now
      // categoryId: "507f1f77bcf86cd799439011", // Default ObjectId, should be replaced with actual category reference

      // Set initial status
      status: videoType === "live" ? 2 : 3, // processing
      clientStatus: "processing",

      // Storage configuration
      storageName: STORAGE_CONFIG.bucketName,
      storageProvider: "gcp",
      storageRegion: BUCKET_REGION,
      storageEndpoint: STORAGE_ENDPOINT,

      // File information
      fileName: fileName,
      thumbnailName: thumbnailName,
      filePath: `${STREAMS_FOLDER}${fileName}`,
      publicUrl: publicUrl,
      uploadUrl: uploadUrl,

      // Additional default values
      aspectRatio: "16:9",
      streamBitrate: 6,
      autoIndexAudioVideo: true,
      promoCreationCount: 1,
      onAirDate: moment().format(),
      processCompleteProgress: 0,
      processingDuration: 0,
      processingStorage: 0,
      highlightConsumption: {
        highlightStorage: 0,
        highlightTime: 0,
      },

      // AI and processing flags
      autoProcessAI: false,
      isAiTaken: false,
      aiCompletionIndicator: false,

      // Stream configuration
      config: {
        storage: STORAGE_CONFIG,
      },

      // Source tracking
      source: "api_service",
    };

    // Create the stream
    const newStream = new Stream(streamData);
    const savedStream = await newStream.save();

    logger.info(`Stream created successfully: ${streamId}`, {
      streamId,
      userId,
      title,
      url,
    });

    // Populate match metadata cache for Media Library (fire-and-forget, retries if DSG returns incomplete data)
    if (matchId && String(matchId).trim()) {
      syncMatchMetadataCache({
        matchId: String(matchId).trim(),
        streamId,
        organization: organizationId || undefined,
        category: category || "",
      })
        .catch((err) => logger.warn("Match metadata cache populate failed:", err?.message || err));
    }

    // Resolve template from prestream template selection
    let resolvedTemplate = null;
    let preTemplate = null;
    try {
      const selectedTemplateId =
        req.body?.videoTemplateId ||
        req.body?.metadata?.videoTemplateId;
      if (selectedTemplateId && userId) {
        preTemplate = await PreStreamTemplate.findOne({ _id: selectedTemplateId, userId });
        if (preTemplate && preTemplate.videoTemplateId) {
          const vt = await VideoTemplate.findById(preTemplate.videoTemplateId);
          if (vt) {
            resolvedTemplate = {
              Ai_Server: preTemplate.analysisServer || "",
              Template_name: vt.name,
              Region: vt.region || "",
              Width: vt.width || undefined,
              Height: vt.height || undefined,
              Preset: vt.templatePreset || "",
              Bitrate: vt.bitrate || undefined,
              Bitrate_mode: vt.bitrateMode || "",
              Maxrate: vt.maxrate || undefined,
              Bufsize: vt.bufsize || undefined,
              FPS: vt.fps || undefined,
              FPS_Mode: vt.fpsMode || "",
              Streaming_type: vt.streamingType || "",
              File_type: vt.fileType || "",
              Segment_duration: vt.segmentDuration || undefined,
              Playlist_size: vt.playlistSize || undefined,
              Input_type: (vt.inputType || "").toUpperCase().replace(/-/g, "_"),
              Audio_codec: vt.audioCodec || "",
              Audio_bitrate: vt.audioBitrate || "",
              Multi_audio: vt.multiAudio || "",
              SRT_mode: vt.srtMode || "",
              SRT_passphrase: vt.srtPassphrase || "",
              SRT_latency: vt.srtLatency || undefined,
              SRT_peerlatency: vt.srtPeerLatency || undefined,
              SRT_rcvbuf: vt.srtRecvBuffer || undefined,
              SRT_sndbuf: vt.srtSendBuffer || undefined,
              SRT_tlpktdrop: vt.srtPacketDrop || undefined,
              SRT_pkt_tsbpd_latency: vt.srtPacketLatency || undefined,
              Live_regions: vt.liveRegion || vt.region || "",
              Deinterlace: "auto",
            };
          }
        }
      }
    } catch (e) {
      logger.error("Failed to resolve templates for AI payload", e);
    }

    // Call AI service to start stream processing
    try {
      const aiPayload = {
        stream_id: savedStream.streamId,
        input_type: isLive ? "live" : "recorded",
        // video_type: "hls",
        input_url: savedStream.url || "", // Use the stream URL or empty string
        language: rawStreamLanguage || "eng",
        ...(resolvedTemplate ? { template: resolvedTemplate } : {}),
      };

      logger.info(
        `Calling AI service for stream: ${savedStream.streamId}`,
        aiPayload
      );
      const aiResponse = await axios.post(
        `http://34.14.203.238:5002/start_stream`,
        aiPayload,
        {
          timeout: 120000, // 120 second timeout
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      logger.info(
        `AI service response for stream ${savedStream.streamId}:`,
        aiResponse.data
      );
      // Update stream with AI response data
      if (aiResponse.data && aiResponse.data.public_hls_url) {
        savedStream.url = url;
        savedStream.analysis_server = (preTemplate && preTemplate.analysisServer) ? preTemplate.analysisServer : 'default';
        savedStream.recording_server = (preTemplate && preTemplate.recordingServer) ? preTemplate.recordingServer : 'default';
        // Store server address if live
        if (isLive && aiResponse.data.ip_address) {
          savedStream.server_address = aiResponse.data.ip_address;
        }
        savedStream.url = savedStream.url ;
        savedStream.hlsS3URL = aiResponse.data.public_hls_url;
        if (preTemplate) {
          savedStream.template_id = String(preTemplate._id);
          savedStream.template_name = preTemplate.name || savedStream.template_name;
        }
        savedStream.status = videoType === 'recorded' ? 3 : 2; // Set to processing status if recorded, else live
        await savedStream.save();
        logger.info(
          `Stream ${savedStream.streamId} updated with AI response data`
        );
      }
    } catch (aiError) {
      logger.error(
        `AI service call failed for stream ${savedStream.streamId}:`,
        aiError.message
      );
      // Don't fail the entire request if AI service fails
      // Stream is still created, just without AI processing
    }

    res.status(201).json({
      status: "success",
      message: "Stream created successfully",
      data: {
        stream: savedStream,
        uploadUrl: uploadUrl,
        publicUrl: publicUrl,
        fileName: fileName,
        storage: {
          provider: "gcp",
          bucket: BUCKET_NAME,
          region: BUCKET_REGION,
          folder: STREAMS_FOLDER,
        },
      },
    });
  } catch (error) {
    logger.error("Error creating stream:", error);

    // Handle validation errors
    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err) => err.message
      );
      return res.status(400).json({
        status: "error",
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(409).json({
        status: "error",
        message: "Stream with this identifier already exists",
      });
    }

    res.status(500).json({
      status: "error",
      message: "Internal server error while creating stream",
    });
  }
};

/**
 * Proxy DSG images to avoid hotlink restrictions and referrer issues
 * @route GET /api/streams/dsg/image
 * @access Private
 */
export const getDsgImage = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ status: "error", message: "url is required" });
    }
    const trimmed = String(url).trim().replace(/[`"]/g, "");
    const allowedHost = "dsg-images.com";
    try {
      const u = new URL(trimmed);
      if (!u.hostname.endsWith(allowedHost)) {
        return res.status(403).json({ status: "error", message: "host not allowed" });
      }
    } catch {
      return res.status(400).json({ status: "error", message: "invalid url" });
    }
    const resp = await axios.get(trimmed, {
      responseType: "arraybuffer",
      headers: {
        Accept: "image/*",
        "User-Agent": "ZentagAI/1.0 (+studio.zentag.ai)",
      },
      validateStatus: () => true,
    });
    if (resp.status < 200 || resp.status >= 300) {
      return res.status(502).json({ status: "error", message: `Upstream image status ${resp.status}` });
    }
    const ct = resp.headers["content-type"] || "image/png";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return res.send(Buffer.from(resp.data));
  } catch (error) {
    logger.error("Error proxying DSG image:", error?.message || error);
    return res.status(500).json({ status: "error", message: "Failed to proxy image" });
  }
};
/**
 * Get all streams with pagination, filters, and projection
 * @route GET /api/streams
 * @access Private
 */
export const getStreams = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      userId,
      organizationId,
      status,
      category,
      searchText = "",
      startDate,
      endDate,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build match query: show org data to all org members; else fall back to user scope
    const matchQuery = { ...activeFilter(req) };
    const orgIdForUser = await getCurrentUserOrgId(req);
    if (organizationId) {
      matchQuery.organization = organizationId;
    } else if (orgIdForUser) {
      // User is in an org: show all data for that org (visible to every member)
      matchQuery.organization = orgIdForUser;
    } else if (userId) {
      matchQuery.userId = userId;
    } else if (req.user?.userId) {
      matchQuery.userId = req.user.userId;
    }

    // Filter by status
    if (status) {
      matchQuery.status = parseInt(status);
    }

    // Filter by category (sports)
    if (category) {
      if (Array.isArray(category)) {
        matchQuery.category = { $in: category };
      } else {
        matchQuery.category = category;
      }
    }

    // Filter by title (search text)
    if (searchText && searchText.trim()) {
      matchQuery.title = { $regex: searchText.trim(), $options: "i" };
    }
    // Filter by date range - handle ISO timestamp strings from frontend
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) {
        // Frontend sends ISO string with start of day (00:00:00)
        matchQuery.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        // Frontend sends ISO string with end of day (23:59:59)
        matchQuery.createdAt.$lte = new Date(endDate);
      }
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [
      { $match: matchQuery },
      { $sort: sortObj },
      {
        $lookup: {
          from: "clips",
          let: { streamId: "$streamId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$$streamId", "$streamId"] },
                thumbnailUrl: { $ne: null, $ne: "" },
                isDeleted: { $ne: true },
              },
            },
            { $project: { thumbnailUrl: 1, _id: 0 } },
            { $limit: 1 },
          ],
          as: "clipsWithThumbnails",
        },
      },
      {
        $lookup: {
          from: "clips",
          let: { streamId: "$streamId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$$streamId", "$streamId"] },
                isDeleted: { $ne: true },
              },
            },
            { $count: "count" },
          ],
          as: "clipsCountData",
        },
      },
      {
        $addFields: {
          videoThumbnailUrl: {
            $cond: {
              if: { $gt: [{ $size: "$clipsWithThumbnails" }, 0] },
              then: { $arrayElemAt: ["$clipsWithThumbnails.thumbnailUrl", 0] },
              else: { $ifNull: ["$videoThumbnailUrl", "$defaultThumbnailUrl"] },
            },
          },
          clipsCount: {
            $ifNull: [{ $arrayElemAt: ["$clipsCountData.count", 0] }, 0],
          },
        },
      },
      {
        $facet: {
          streams: [
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                _id: 1,
                streamId: 1,
                title: 1,
                category: 1,
                status: 1,
                url: 1,
                hlsS3URL: 1,
                thumb_url: 1,
                defaultThumbnailUrl: 1,
                videoThumbnailUrl: 1,
                createdAt: 1,
                createdDate: 1,
                userId: 1,
                duration: 1,
                inputVideoDuration: 1,
                size: 1,
                aspectRatio: 1,
                matchDate: 1,
                isLive: 1,
                vod: 1,
                clipsCount: 1,
                highlightsCount: 1,
                processCompleteProgress: 1,
                processingStorage: 1,
                videoType: 1,
                competitionType: 1,
                gameDate: 1,
                onAirDate: 1,
                fireOn: 1,
                tags: 1,
                limitation: 1,
                streamAccess: 1,
                entityId: 1,
                referenceStream: 1,
                previousRecordingURLs: 1,
                isMediaLive: 1,
                mediaLiveConfig: 1,
                updatedAt: 1,
                tournamentId: 1,
                team1Id: 1,
                team2Id: 1,
                analysis_server: 1,
                matchId: 1,
                videoTemplateId: 1,
                streamLanguage: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    // Execute aggregation
    const [result] = await Stream.aggregate(pipeline).allowDiskUse(true);

    const streams = result.streams || [];
    const total = result.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      status: "success",
      data: {
        streams,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
        filters: {
          userId,
          status,
          category,
          searchText,
          startDate,
          endDate,
          sortBy,
          sortOrder,
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching streams:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error while fetching streams",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get stream by ID
 * @route GET /api/streams/:id
 * @access Private
 */
export const getStreamById = async (req, res) => {
  try {
    const { id } = req.params;

    // Log the incoming ID for debugging
    logger.debug("Fetching stream with streamId:", id);

    // Use raw MongoDB query to bypass Mongoose casting issues
    const db = mongoose.connection.db;
    const collection = db.collection("streams");

    const stream = await collection.findOne(
      { streamId: id, isDeleted: { $ne: true } },
      {
        projection: {
          _id: 1,
          streamId: 1,
          title: 1,
          category: 1,
          status: 1,
          url: 1,
          hlsS3URL: 1,
          thumb_url: 1,
          defaultThumbnailUrl: 1,
          createdAt: 1,
          createdDate: 1,
          userId: 1,
          duration: 1,
          inputVideoDuration: 1,
          size: 1,
          aspectRatio: 1,
          isLive: 1,
          vod: 1,
          clipsCount: 1,
          highlightsCount: 1,
          processCompleteProgress: 1,
          processingStorage: 1,
          videoType: 1,
          competitionType: 1,
          gameDate: 1,
          onAirDate: 1,
          fireOn: 1,
          tags: 1,
          limitation: 1,
          streamAccess: 1,
          entityId: 1,
          referenceStream: 1,
          previousRecordingURLs: 1,
          isMediaLive: 1,
          mediaLiveConfig: 1,
          updatedAt: 1,
          tournamentId: 1,
          team1Id: 1,
          team2Id: 1,
          analysis_server: 1,
          matchId: 1,
          matchDate: 1,
          videoThumbnailUrl: 1,
          videoTemplateId: 1,
          streamLanguage: 1,
        },
      }
    );

    if (!stream) {
      return res.status(404).json({
        status: "error",
        message: "Stream not found",
      });
    }

    res.json({
      status: "success",
      data: {
        stream,
      },
    });
  } catch (error) {
    logger.error("Error in getStreamById:", error.message);
    logger.error("Stack trace:", error.stack);
    logger.error("Error fetching stream:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error while fetching stream",
    });
  }
};

/**
 * Update stream
 * @route PUT /api/streams/:id
 * @access Private
 */
export const updateStream = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData.streamId;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    if (updateData?.videoTemplate && !updateData?.videoTemplateId) {
      updateData.videoTemplateId = updateData.videoTemplate;
    }
    if (updateData?.videoTemplate) {
      delete updateData.videoTemplate;
    }
    if (updateData?.streamLanguage && typeof updateData.streamLanguage === "string") {
      updateData.streamLanguage = updateData.streamLanguage.trim();
    }

    let stream;
    // Support both Mongo ObjectId and short streamId
    updateData.updatedAt = new Date();
    Object.assign(updateData, getAuditStamp(req));
    if (mongoose.Types.ObjectId.isValid(id)) {
      // Update by _id when a valid ObjectId is provided
      stream = await Stream.findOneAndUpdate({ _id: id, ...activeFilter(req) }, updateData, {
        new: true,
        runValidators: true,
      });
    } else {
      // Update by short streamId when non-ObjectId is provided
      stream = await Stream.findOneAndUpdate(
        { streamId: id, ...activeFilter(req) },
        { $set: updateData },
        { new: true, runValidators: true }
      );
    }

    if (!stream) {
      return res.status(404).json({
        status: "error",
        message: "Stream not found",
      });
    }

    logger.info(`Stream updated successfully: ${stream.streamId}`, {
      streamId: stream.streamId,
      updatedFields: Object.keys(updateData),
    });

    // Populate match metadata cache when matchId is set/updated (fire-and-forget, retries if DSG returns incomplete data)
    const matchIdToCache = stream.matchId || updateData.matchId;
    if (matchIdToCache && String(matchIdToCache).trim()) {
      syncMatchMetadataCache({
        matchId: String(matchIdToCache).trim(),
        streamId: stream.streamId,
        organization: stream.organization || undefined,
        category: stream.category || updateData.category || "",
      })
        .catch((err) => logger.warn("Match metadata cache populate failed:", err?.message || err));
    }

    res.json({
      status: "success",
      message: "Stream updated successfully",
      data: {
        stream,
      },
    });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "stream",
      entityId: stream.streamId || stream._id?.toString?.(),
      orgId: stream.organization || null,
      metadata: { fields: Object.keys(updateData || {}) },
    });
  } catch (error) {
    logger.error("Error updating stream:", error);

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err) => err.message
      );
      return res.status(400).json({
        status: "error",
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    res.status(500).json({
      status: "error",
      message: "Internal server error while updating stream",
    });
  }
};

/**
 * Delete stream
 * @route DELETE /api/streams/:id
 * @access Private
 */
export const deleteStream = async (req, res) => {
  try {
    const { id } = req.params;

    // Support both MongoDB _id and streamId (frontend sends streamId in URL)
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    const stream = isObjectId
      ? await Stream.findOne({ _id: id, ...activeFilter(req) })
      : await Stream.findOne({ streamId: id, ...activeFilter(req) });

    if (!stream) {
      return res.status(404).json({
        status: "error",
        message: "Stream not found",
      });
    }

    const streamId = stream.streamId;

    const [deletedClips, deletedFolders] = await Promise.all([
      Clip.updateMany(
        { streamId: streamId, isDeleted: { $ne: true } },
        { $set: getSoftDeleteStamp(req) },
      ),
      Folder.updateMany(
        { streamId: streamId, isDeleted: { $ne: true } },
        { $set: getSoftDeleteStamp(req) },
      ),
    ]);
    await Stream.updateOne(
      { _id: stream._id, isDeleted: { $ne: true } },
      { $set: getSoftDeleteStamp(req) },
    );

    logger.info(`Stream and associated data deleted successfully: ${streamId}`, {
      streamId: streamId,
      userId: stream.userId,
      deletedClips: deletedClips.modifiedCount ?? 0,
      deletedFolders: deletedFolders.modifiedCount ?? 0,
    });

    res.json({
      status: "success",
      message: "Stream soft deleted successfully",
      data: {
        deletedClips: deletedClips.modifiedCount ?? 0,
        deletedFolders: deletedFolders.modifiedCount ?? 0,
      },
    });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "delete",
      entity: "stream",
      entityId: stream.streamId || stream._id?.toString?.(),
      orgId: stream.organization || null,
    });
  } catch (error) {
    logger.error("Error deleting stream:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error while deleting stream",
    });
  }
};

// Export storage configuration for reference
export const getStorageConfig = () => {
  return {
    ...STORAGE_CONFIG,
    provider: "gcp",
    // Hide sensitive information
    serviceAccountPath: "env_config/gcp-service-account.json",
    keyFileConfigured: true,
  };
};

// Export helper functions for use in other modules
export { generateUploadUrl, generatePublicUrl, fileExists };

/**
 * End a live stream
 * @route PUT /api/streams/:id/end
 * @access Private
 */
export const endStream = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the stream by streamId (shortId)
    const stream = await Stream.findOne({ streamId: id });

    if (!stream) {
      return res.status(404).json({
        status: "error",
        message: "Stream not found",
      });
    }

    // Check if stream is currently live or processing
    if (!(stream.isLive || stream.status === 3)) {
      return res.status(400).json({
        status: "error",
        message: "Stream is not currently live or processing",
      });
    }

    // Update stream to end it
    stream.isLive = false;
    stream.status = 1; // Set to completed status
    stream.updatedAt = new Date();
    
    await stream.save();

    // Immediately respond to client; do not wait for AI stop response
    logger.info(`Stream ended successfully: ${stream.streamId}`, {
      streamId: stream.streamId,
      userId: stream.userId,
      title: stream.title,
    });

    res.json({
      status: "success",
      message: "Stream ended successfully",
      data: {
        stream: {
          streamId: stream.streamId,
          title: stream.title,
          isLive: stream.isLive,
          status: stream.status,
          updatedAt: stream.updatedAt,
        },
      },
    });

    // Fire-and-forget AI endpoint to stop stream processing
    axios
      .post(
        `http://34.14.203.238:5002/stop_stream/${stream.streamId}`,
        {},
        {
          timeout: 120000, // 2 minute timeout
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
      .then((aiResponse) => {
        logger.info(
          `AI service stop response for stream ${stream.streamId}:`,
          aiResponse.data
        );
      })
      .catch((aiError) => {
        logger.error(
          `AI service stop call failed for stream ${stream.streamId}:`,
          aiError.message
        );
        // Do not impact the client response; stream end is already acknowledged
      });
  } catch (error) {
    logger.error("Error ending stream:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error while ending stream",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Fetch match metadata from DSG API (server-side to avoid CORS)
 * @route GET /api/streams/match/:id/metadata
 * @access Private
 */
export const getMatchMetadata = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ status: "error", message: "match id is required" });
    }
    if (!/^\d{7}$/.test(String(id))) {
      logger.warn(`getMatchMetadata invalid match id format: ${id}`);
      // Not strictly blocking; proceed anyway
    }
    const base = process.env.DSG_API_BASE || "https://dsg-api.com";
    const client = req.query.client || process.env.DSG_CLIENT || "dataaistream";
    const authkey = req.query.authkey || process.env.DSG_AUTHKEY || "";
    if (!authkey) {
      return res.status(500).json({
        status: "error",
        message: "DSG authkey is not configured",
      });
    }
    const sport = String(req.query?.category || req.body?.category || 'soccer').toLowerCase();
    const sportPath = sport === 'football' ? 'soccer' : sport;
    const url = `${base}/clients/${client}/${sportPath}/get_matches?type=match&id=${encodeURIComponent(
      id
    )}&client=${client}&authkey=${authkey}&ftype=json_array`;
    const r = await axios.get(url, {
      timeout: 150000,
      headers: {
        "Accept": "application/json",
        "User-Agent": "ZentagAI/1.0 (+studio.zentag.ai)",
      },
      auth: {
        username: req.query.basic_user || client,
        password: req.query.basic_pass || process.env.DSG_BASIC_PASS || "",
      },
      validateStatus: () => true,
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(502).json({
        status: "error",
        message: "Upstream unauthorized. Verify DSG_AUTHKEY, client whitelisting, and IP/domain access.",
      });
    }
    if (r.status < 200 || r.status >= 300) {
      return res.status(502).json({
        status: "error",
        message: `Upstream error status ${r.status}`,
      });
    }
    const payload = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : r.data;
    return res.json({ status: "success", data: payload });
  } catch (error) {
    logger.error("Error fetching match metadata:", error?.message || error);
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch match metadata",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
