import Clip from "../models/Clip.js";
import axios from "axios";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger.js";
import clipList from "../models/Folder.js";
import {
  DEFAULT_AI_HOST,
  AI_SERVER_URL,
  AI_CONVERTER_URL,
  resolveHostByStreamId,
  resolveHostByClipId,
  resolveHostByJobId,
} from "../utils/aiHost.js";
import Stream from "../models/Stream.js";
import { getCurrentUserOrgId, getOrgIdByUserId } from "../utils/organizationHelper.js";
import { getAuditStamp, getSoftDeleteStamp } from "../utils/requestContext.js";
import { activeFilter } from "../utils/softDelete.js";
import { buildBaseAuditFromRequest, writeAuditLog, writeMonitorLog } from "../services/auditLogService.js";
import { invalidateMediaLibraryListCache } from "./mediaLibraryController.js";

function clipIdQuery(clipId) {
  const conditions = [{ id: clipId }];
  if (mongoose.Types.ObjectId.isValid(clipId)) conditions.push({ _id: clipId });
  return { $or: conditions };
}

const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || "http://localhost:3000";

const generateClipHighlight = async (req, res) => {
  try {
    const {
      clipId,
      clips,
      image,
      overlay,
      aspectRatio,
      preSlate,
      postSlate,
      start_time,
      end_time,
      stream_url,
      rating,
      title,
      tags,
      video_urls_single_cms,
    } = req.body || {};

    if (!clipId || !clips || !Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({
        success: false,
        message: "clipId and clips array are required",
      });
    }

    // Find clip by either string id or Mongo _id
    const clip = await Clip.findOne(clipIdQuery(clipId));
    if (!clip) {
      return res
        .status(404)
        .json({ success: false, message: "Clip not found" });
    }

    // Mark clip as processing and persist initial editedClipData context from frontend
    await Clip.findByIdAndUpdate(clip._id, {
      $set: {
        isGeneratePreview: true,
        editedPreviewUrl: "",
        progress: 0,
        clipStatus: "PROCESSING",
        title: clip.title || "",
        tags: tags || clip.tags || [],
        rating: rating || clip.rating || 0,
        start_time:
          typeof start_time === "string" && start_time.trim()
            ? start_time
            : clip.start_time || "",
        end_time:
          typeof end_time === "string" && end_time.trim()
            ? end_time
            : clip.end_time || "",
        editedClipData: {
          ...(clip.editedClipData || {}),
          aspectRatio: aspectRatio || clip.aspectRatio || "16:9",
          clipId: clip._id?.toString() || clip.id,
          clipIdArr: Array.isArray(req.body?.clipIdArr)
            ? req.body.clipIdArr
            : clip.clipIdArr || [],
          clipsinfo: Array.isArray(req.body?.clipsinfo)
            ? req.body.clipsinfo
            : clip.editedClipData?.clipsinfo || [],
          streamId: clip.streamId,
          createdAt: new Date().toISOString(),
        },
      },
    });

    // Extract bumper URLs from pre/post slates
    const introUrl =
      Array.isArray(preSlate) && preSlate[0]?.url ? preSlate[0].url : "";
    const outroUrl =
      Array.isArray(postSlate) && postSlate[0]?.url ? postSlate[0].url : "";

    const hasJoin = Array.isArray(clips) && clips.length > 0;
    const hasSingleCms =
      typeof video_urls_single_cms === "string" &&
      video_urls_single_cms.trim().length > 0;
    const hasTrim =
      !!stream_url &&
      ((typeof start_time === "string" && start_time.trim()) ||
        (typeof end_time === "string" && end_time.trim()));

    // Base AI payload
    const aiPayload = {
      stream_id: clip.streamId || clipId,
      sports: clip.customData?.sportName || "",
      join_clip: hasJoin ? { join_urls: clips } : null,
      overlay: null,
      graphics: null,
      trim_manual: null,
      video_urls_single_cms: hasSingleCms ? video_urls_single_cms : "",
      webhook_url_single_cms: `${WEBHOOK_BASE_URL}/api/clips/highlight-webhook`,
      aspect_ratio: aspectRatio || clip.aspectRatio || "16:9",
    };

    // Build graphics object from explicit graphics or image
    const graphicsObj = req.body?.graphics
      ? req.body.graphics
      : image && image.url
        ? { logo_urls: [image.url], position: image.position || [] }
        : null;

    // Build overlay object if provided
    const overlayObj = overlay || null;

    // If trim scenario, nest overlay/graphics/bumper into trim_manual
    if (hasTrim) {
      aiPayload.join_clip = null;
      aiPayload.trim_manual = {
        stream_url,
        start_time:
          typeof start_time === "string" && start_time.trim()
            ? start_time
            : undefined,
        end_time:
          typeof end_time === "string" && end_time.trim()
            ? end_time
            : undefined,
        webhook_url: `${WEBHOOK_BASE_URL}/api/clips/highlight-webhook`,
        bumper:
          introUrl || outroUrl
            ? { intro: introUrl || "", outro: outroUrl || "" }
            : null,
        overlay: overlayObj,
        graphics: graphicsObj,
      };
    } else {
      // Non-trim scenarios: set top-level overlay/graphics if present
      aiPayload.overlay = overlayObj;
      aiPayload.graphics = graphicsObj;
    }
    let aiResponse;
    try {
      const host = await resolveHostByStreamId(clip.streamId);
      aiResponse = await axios.post(
        `${AI_SERVER_URL(host)}/process_video`,
        aiPayload,
        {
          timeout: 60000,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("[generateClipHighlight] AI server error:", error.message);
      return res.status(502).json({
        success: false,
        message: "AI server error",
        error: error.message,
      });
    }

    const data = aiResponse?.data || {};
    await Clip.findByIdAndUpdate(clip._id, {
      $set: {
        jobId: data.job_id,
        isGeneratePreview: true,
        // Keep incoming context in editedClipData
        editedClipData: {
          ...(clip.editedClipData || {}),
          clipId: clip._id?.toString() || clip.id,
          clipIdArr: Array.isArray(req.body?.clipIdArr)
            ? req.body.clipIdArr
            : clip.clipIdArr || [],
          streamId: clip.streamId,
          createdAt: new Date().toISOString(),
          clipsinfo: Array.isArray(req.body?.clipsinfo)
            ? req.body.clipsinfo
            : clip.editedClipData?.clipsinfo || [],
        },
      },
    });

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "clip",
      entityId: clip.id || clip._id?.toString(),
      orgId: clip.organization ?? null,
      metadata: {
        source: "generateClipHighlight",
        job_id: data.job_id,
        hasTrim: !!hasTrim,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Clip highlight generation initiated",
      data: {
        job_id: data.job_id,
        status: data.status,
        stream_id: data.stream_id,
      },
    });
  } catch (error) {
    logger.error("[generateClipHighlight] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate clip highlight",
      error: error.message,
    });
  }
};

// Delete an edited clip entry by documentId
const deleteEditedClip = async (req, res) => {
  try {
    const { clipId, documentId } = req.body || {};
    if (!clipId || !documentId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "clipId and documentId are required",
        });
    }
    const clip = await Clip.findOne(clipIdQuery(clipId));
    if (!clip) {
      return res
        .status(404)
        .json({ success: false, message: "Clip not found" });
    }
    const before = Array.isArray(clip.editedVideos)
      ? clip.editedVideos.length
      : 0;
    const newEdited = (
      Array.isArray(clip.editedVideos) ? clip.editedVideos : []
    ).filter((v) => String(v?.documentId || v?.id) !== String(documentId));
    if (newEdited.length === before) {
      return res
        .status(404)
        .json({ success: false, message: "Edited clip entry not found" });
    }
    clip.editedVideos = newEdited;
    Object.assign(clip, getAuditStamp(req));
    await clip.save();
    return res
      .status(200)
      .json({
        success: true,
        message: "Clip deleted successfully",
        data: { clipId, documentId },
      });
  } catch (error) {
    logger.error("[deleteEditedClip] Error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to delete edited clip",
        error: error.message,
      });
  }
};

const clipHighlightWebhook = async (req, res) => {
  try {
    const {
      job_id,
      status,
      result_url,
      percent,
      progress,
      error,
      thumbnail,
      thumbnails,
    } = req.body || {};
    const clip = await Clip.findOne({ jobId: job_id });
    if (!clip) {
      return res
        .status(404)
        .json({ success: false, message: "Clip not found for job_id" });
    }
    const update = {};
    update.progress = typeof percent !== "undefined" ? percent : progress || 0;
    if (status === "completed" && result_url) {
      update.editedPreviewUrl = result_url;
      update.clipStatus = "COMPLETED";
      update.status = 1;
      update.progress = 100;
      update.thumbnailUrl = thumbnail || clip.thumbnailUrl;
      update.thumbnails = thumbnails || clip.thumbnails;
    } else if (status === "failed" || error) {
      update.clipStatus = "FAILED";
      update.status = 2;
      update.progress = 0;
    }
    await Clip.findByIdAndUpdate(clip._id, { $set: update });
    return res
      .status(200)
      .json({ success: true, message: "Webhook processed" });
  } catch (error) {
    logger.error("[clipHighlightWebhook] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process webhook",
      error: error.message,
    });
  }
};

const getClipHighlightProgressByJobId = async (req, res) => {
  try {
    const { job_id } = req.query;
    if (!job_id) {
      return res.status(400).json({
        success: false,
        message: "job_id query parameter is required",
      });
    }
    let aiResp;
    try {
      const hostProg = await resolveHostByJobId(job_id);
      aiResp = await axios.get(
        `${AI_SERVER_URL(hostProg)}/progress?job_id=${job_id}`,
      );
    } catch (error) {
      logger.error(
        "[getClipHighlightProgressByJobId] AI server error:",
        error.message,
      );
      return res.status(502).json({
        success: false,
        message: "AI server error",
        error: error.message,
      });
    }
    const aiResult = aiResp?.data || {};
    const sanitized = {
      ...aiResult,
      percent: aiResult.percent,
      videoUrl: aiResult.video_url,
    };
    // console.log(aiResult, sanitized,"here........");
    // Persist into clip on completion
    if (aiResult?.percent === 100 && aiResult?.status === "completed") {
      const clip = await Clip.findOne({ jobId: job_id });
      if (clip) {
        const prev = clip.editedClipData || {};
        const editedClipData = {
          ...prev,
          clipId: clip._id?.toString() || clip.id,
          clipIdArr: Array.isArray(prev.clipIdArr) ? prev.clipIdArr : [],
          streamId: clip.streamId,
          createdAt: prev.createdAt || new Date().toISOString(),
          clipsinfo: Array.isArray(prev.clipsinfo) ? prev.clipsinfo : [],
          aspect_ratio: aiResult?.aspect_ratio || clip.aspectRatio || "16:9",
          vod: false,
          totalDurationWithoutBumper:
            clip.totalDurationWithoutBumper || clip.duration || 0,
          documentId: aiResult?.documentId || uuidv4().replace(/-/g, ""),
          progressPercent: 100,
          status: "Completed",
          previewUrl: aiResult?.video_url || "",
          thumbnail: Array.isArray(aiResult?.thumbnail)
            ? aiResult.thumbnail[0]
            : aiResult?.thumbnail || "",
          thumbnails: aiResult?.thumbnails || [],
          duration: aiResult?.high_dura || clip.duration || 0,
          timeTaken: aiResult?.execution_time || 0,
          isPreview: false,
          timeTakenAutoFlipQ: aiResult?.execution_time || 0,
        };
        const updateSet = {
          editedClipData,
          editedPreviewUrl: editedClipData.previewUrl,
          description: aiResult?.transcript || "",
          clipStatus: "COMPLETED",
          status: 1,
          progress: 100,
        };
        if (
          aiResult?.istrime === true &&
          typeof aiResult?.video_url === "string" &&
          aiResult.video_url
        ) {
          updateSet.videoUrl = aiResult.video_url;
        }
        const hd = Number(aiResult?.high_dura);
        if (Number.isFinite(hd) && hd > 0) {
          updateSet.duration = hd;
          updateSet.totalDurationWithoutBumper = hd;
        }
        await Clip.findByIdAndUpdate(clip._id, { $set: updateSet });
      }
    }
    return res.status(200).json({ success: true, data: sanitized });
  } catch (error) {
    logger.error("[getClipHighlightProgressByJobId] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get clip highlight progress",
      error: error.message,
    });
  }
};

const resetClipHighlightStatus = async (req, res) => {
  try {
    const { clipId } = req.params;
    const clip = await Clip.findOne(clipIdQuery(clipId));
    if (!clip) {
      return res
        .status(404)
        .json({ success: false, message: "Clip not found" });
    }
    await Clip.findByIdAndUpdate(clip._id, {
      $set: {
        isGeneratePreview: false,
        progress: 0,
        clipStatus: "PROCESSING",
        jobId: null,
        editedPreviewUrl: "",
        editedClipData: {},
      },
    });
    return res
      .status(200)
      .json({ success: true, message: "Clip highlight status reset" });
  } catch (error) {
    logger.error("[resetClipHighlightStatus] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset clip highlight status",
      error: error.message,
    });
  }
};

// Save clip from folder preview
const saveClipFromFolder = async (req, res) => {
  try {
    const { folderId, title, aspectRatio } = req.body || {};
    if (!folderId || !title) {
      return res
        .status(400)
        .json({ success: false, message: "folderId and title are required" });
    }
    const folder = await clipList.findById(folderId);
    if (!folder) {
      return res
        .status(404)
        .json({ success: false, message: "Folder not found" });
    }
    const videoUrl = folder.previewUrl || "";
    if (!videoUrl || typeof videoUrl !== "string") {
      return res
        .status(400)
        .json({
          success: false,
          message: "No valid folder preview available to save",
        });
    }

    // Helper to format seconds → HH:MM:SS
    const secondsToHMS = (sec) => {
      const s = Math.max(0, Math.round(Number(sec || 0)));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(h)}:${pad(m)}:${pad(ss)}`;
    };

    // Build new clip payload taking inspiration from generate_clips implementation
    const organizationId = await getCurrentUserOrgId(req);
    const newId = uuidv4();
    const clipDoc = new Clip({
      streamId: folder.streamId,
      id: newId,
      title,
      duration: folder.totalDuration || 0,
      start_time: null,
      end_time: null,
      rating: typeof folder.rating === "number" ? folder.rating : 1,
      tags: Array.isArray(folder.tags) ? folder.tags : [],
      userId: folder.userId || "",
      aspectRatio: aspectRatio || folder.aspectRatio || "16:9",
      status: 1,
      clipStatus: "COMPLETED",
      videoUrl,
      thumbnailUrl: folder.thumbnail || "",
      thumbnails: Array.isArray(folder.thumbnails)
        ? folder.thumbnails
        : folder.thumbnail
          ? [folder.thumbnail]
          : [],
      progress: 100,
      createdBy: req.user?.id || undefined,
      customData: { sportName: "" },
    });
    if (organizationId) clipDoc.organization = organizationId;

    await clipDoc.save();
    return res
      .status(201)
      .json({
        success: true,
        message: "Clip saved from folder",
        data: { id: clipDoc.id },
      });
  } catch (error) {
    logger.error("[saveClipFromFolder] Error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to save clip from folder",
        error: error.message,
      });
  }
};

// Generate input-ratio cropped clip preview (manual crop)
const generateInputRatioClip = async (req, res) => {
  try {
    const { clipId, ratio, timeSec, playbackRate, videoUrl, cropRect } =
      req.body || {};
    if (!clipId || !videoUrl || !cropRect) {
      return res
        .status(400)
        .json({
          success: false,
          message: "clipId, videoUrl and cropRect are required",
        });
    }
    const payload = {
      stream_id: clipId,
      sports: "",
      join_clip: null,
      graphics: null,
      overlay: null,
      trim_manual: {
        stream_url: videoUrl,
        start_time: "00:00:00",
        end_time: "00:00:02",
        webhook_url: `${WEBHOOK_BASE_URL}/api/clips/webhook/${clipId}`,
        dynamic_crop: {
          ratio,
          x: cropRect.x_px,
          y: cropRect.y_px,
          w: cropRect.width_px,
          h: cropRect.height_px,
        },
      },
      video_urls_single_cms: "",
      webhook_url_single_cms: `${WEBHOOK_BASE_URL}/api/clips/webhook/${clipId}`,
      aspect_ratio: ratio || "9:16",
    };
    const hostIR = await resolveHostByClipId(clipId);
    const aiResp = await axios.post(
      `${AI_SERVER_URL(hostIR)}/process_video`,
      payload,
      {
        timeout: 30000,
        headers: { "Content-Type": "application/json" },
      },
    );
    return res
      .status(200)
      .json({
        success: true,
        data: aiResp.data,
        message: "Input-ratio crop initiated",
      });
  } catch (error) {
    logger.error("[generateInputRatioClip] Error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to generate input-ratio clip",
        error: error.message,
      });
  }
};

// Generate clip with AI server
const generateClip = async (req, res) => {
  try {
    const {
      streamId,
      title,
      startTime,
      endTime,
      speed = 1,
      rating = 1,
      tags = [],
      aspectRatio = "16:9",
      sports = "",
      streamUrl = "",
      userId,
      duration,
    } = req.body;

    // Validate required fields
    if (
      !streamId ||
      !title ||
      startTime === undefined ||
      endTime === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: streamId, title, startTime, endTime",
      });
    }

    // Generate unique clip ID
    const clipId = uuidv4();

    const organizationId = await getCurrentUserOrgId(req);

    // Create clip record in database (store as seconds for compatibility)
    const clipData = {
      streamId,
      id: clipId,
      title,
      start_time: startTime,
      end_time: endTime,
      duration,
      speed,
      rating,
      tags,
      userId,
      aspectRatio,
      status: 2, // 2 = unpublished/processing (Number as per schema)
      clipStatus: "PROCESSING", // String enum for processing status
      entityId: req.body.entityId || "default-entity", // Required field
      customData: {
        sportName: sports || "",
      },
    };
    if (organizationId) clipData.organization = organizationId;

    // Only set createdBy if user is authenticated
    if (req.user?.id) {
      clipData.createdBy = req.user.id;
    }

    const clip = new Clip(clipData);

    await clip.save();

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "create",
      entity: "clip",
      entityId: clip.id || clip._id?.toString(),
      orgId: organizationId ?? null,
      metadata: { source: "generateClip", streamId },
    });

    // Prepare payload for AI server (use original HH:MM:SS format)
    const aiPayload = {
      stream_id: streamId,
      sports: sports,
      join_clip: null,
      graphics: null,
      overlay: null,
      trim_manual: {
        stream_url: streamUrl,
        start_time: startTime,
        end_time: endTime,
        webhook_url: `${WEBHOOK_BASE_URL}/api/clips/webhook/${clipId}`,
        bumper: null,
        overlay: null,
        graphics: null,
      },
      video_urls_single_cms: "",
      webhook_url_single_cms: `${WEBHOOK_BASE_URL}/api/clips/webhook/${clipId}`,
      aspect_ratio: aspectRatio,
    };

    // Send request to AI server
    try {
      const hostGC = await resolveHostByStreamId(streamId);
      const aiResponse = await axios.post(
        `${AI_SERVER_URL(hostGC)}/process_video`,
        aiPayload,
        {
          timeout: 30000,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      // Update clip with job ID from AI server
      clip.jobId = aiResponse.data.job_id;
      // clip.aiServerResponse = aiResponse.data;
      await clip.save();
      res.status(200).json({
        success: true,
        message: "Clip generation started successfully",
        data: {
          clipId: clip.id,
          jobId: aiResponse.data.job_id,
          status: aiResponse.data.status,
          streamId: aiResponse.data.stream_id,
        },
      });
    } catch (aiError) {
      console.error("AI Server Error:", aiError.message);

      // Do not persist failed clips; remove the record
      try {
        await Clip.updateOne({ id: clipId }, { $set: getSoftDeleteStamp(req) });
      } catch (delErr) {
        logger.error("Failed to remove failed clip record:", delErr);
      }

      writeMonitorLog(
        {
          action: "api_failure",
          entity: "clip",
          entityId: clip?.id || clipId,
          orgId: clip?.organization ?? null,
          statusCode: 500,
          metadata: {
            source: "generateClip",
            reason: "AI server error on start",
            error: aiError.message,
            clipId,
          },
        },
        req,
      );

      res.status(500).json({
        success: false,
        message: "Failed to start clip generation",
        error: aiError.message,
      });
    }
  } catch (error) {
    console.error("Generate Clip Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// AutoFlip: generate aspect-ratio-specific clip using AI converter
export const autoflip = async (req, res) => {
  try {
    const { clipId } = req.params;
    const { aspect_ratio } = req.body;

    if (!clipId || !aspect_ratio) {
      return res.status(400).json({
        success: false,
        message: "clipId and aspect_ratio are required",
      });
    }

    // Find the clip by string id (UUID) or Mongo _id (when clipId is 24-char hex)
    const clip = await Clip.findOne({
      ...clipIdQuery(clipId),
      isDeleted: { $ne: true },
    });

    if (!clip) {
      return res
        .status(404)
        .json({ success: false, message: "Clip not found" });
    }

    // Determine original 16:9 URL
    const originalUrl =
      clip.videoUrl || clip.s3_video_url || clip.mainVideoUrl || "";
    if (!originalUrl) {
      return res.status(400).json({
        success: false,
        message: "Original 16:9 video URL not found on clip",
      });
    }

    // If aspect ratio already exists, indicate it
    const existsIndex = (clip.editedVideos || []).findIndex(
      (ev) =>
        String(ev.aspect_ratio).replace(/\s/g, "") ===
        String(aspect_ratio).replace(/\s/g, ""),
    );

    const payload = {
      url: originalUrl,
      aspect_ratio,
      stream_id: clip.streamId || "",
      scene_id: String(clipId || clip._id),
    };

    // Call AI converter
    logger.info(
      `[autoflip] Sending request to AI converter with payload: ${JSON.stringify(
        payload,
      )}`,
    );
    let aiResp;
    try {
      const hostConv = await resolveHostByStreamId(clip.streamId);
      aiResp = await axios.post(AI_CONVERTER_URL(hostConv), payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 3000000,
      });
    } catch (error) {
      logger.error(`[autoflip] AI converter error: ${error.message}`);
      return res.status(502).json({
        success: false,
        message: "AI converter request failed",
        error: error.message,
      });
    }

    const data = aiResp?.data || {};
    const status = data?.status;
    const output = data?.output || {};

    // Prepare edited video object
    const uid = uuidv4();
    const editedVideoObj = {
      documentId: uid.replace(/-/g, ""),
      aspect_ratio: output.aspect_ratio || aspect_ratio,
      // uid,
      event: "autoFlip",
      id: clip.id,
      clipType: "clip",
      folderId: clip.folderId || "",
      duration: clip.duration || 0,
      videoUrl: output.video_urls || "",
      thumbnails: Array.isArray(output.thumbnails)
        ? output.thumbnails
        : output.thumbnail
          ? output.thumbnail
          : [],
      thumbnailUrl: output.thumbnail[0] || "",
      status: status === "success" ? "completed" : "processing",
    };

    // Update editedVideos array (replace if exists, else push)
    if (!clip.editedVideos) clip.editedVideos = [];
    if (existsIndex >= 0) {
      clip.editedVideos[existsIndex] = {
        ...clip.editedVideos[existsIndex],
        ...editedVideoObj,
      };
    } else {
      clip.editedVideos.push(editedVideoObj);
    }
    await clip.save();

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "clip",
      entityId: clip.id || clip._id?.toString(),
      orgId: clip.organization ?? null,
      metadata: {
        source: "autoflip",
        aspect_ratio: aspect_ratio,
        exists: existsIndex >= 0,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Process initiated successfully!",
      data: {
        exists: existsIndex >= 0,
        output: editedVideoObj,
      },
    });
  } catch (error) {
    logger.error("[autoflip] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Webhook handler for AI server responses
const handleWebhook = async (req, res) => {
  try {
    const { clipId } = req.params;
    const webhookData = req.body;

    console.log(`Webhook received for clip ${clipId}:`, webhookData);

    // Find the clip
    const clip = await Clip.findOne({ id: clipId });
    if (!clip) {
      return res.status(404).json({
        success: false,
        message: "Clip not found",
      });
    }
    // Update clip based on webhook data
    if (webhookData.status === "completed") {
      clip.status = 1; // 1 = published/completed (Number as per schema)
      clip.clipStatus = "COMPLETED"; // String enum for completed status
      clip.progress = webhookData.percent || 100;
      clip.videoUrl = webhookData.video_url || "";
      clip.thumbnailUrl = webhookData.thumbnail || "";
      clip.thumbnails = webhookData.thumbnails || [];
    } else if (webhookData.status === "failed") {
      // Do not persist failed clips; remove the record
      try {
        await Clip.updateOne({ _id: clip._id }, { $set: getSoftDeleteStamp(req) });
      } catch (delErr) {
        logger.error("Failed to remove failed clip via webhook:", delErr);
      }
      writeMonitorLog(
        {
          action: "api_failure",
          entity: "clip",
          entityId: clip.id || clip._id?.toString(),
          orgId: clip.organization ?? null,
          statusCode: 200,
          metadata: {
            source: "webhook",
            reason: "AI reported failed",
            clipId,
            webhookStatus: webhookData.status,
          },
        },
        req,
      );
      return res.status(200).json({
        success: true,
        message: "Webhook processed: clip failed and removed",
      });
    } else if (webhookData.percent !== undefined) {
      clip.progress = Math.min(100, Math.max(0, webhookData.percent));
    }

    // Store the complete webhook response
    clip.aiServerResponse = { ...clip.aiServerResponse, ...webhookData };
    await clip.save();

    if (webhookData.status === "completed") {
      writeMonitorLog(
        {
          action: "ai_push",
          entity: "clip",
          entityId: clip.id || clip._id?.toString(),
          orgId: clip.organization ?? null,
          metadata: {
            source: "webhook",
            clipId,
            jobId: clip.jobId,
            hasVideoUrl: !!webhookData.video_url,
            percent: webhookData.percent,
          },
        },
        req,
      );
    }

    res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({
      success: false,
      message: "Webhook processing failed",
      error: error.message,
    });
  }
};

// Get clips for a stream
const getClips = async (req, res) => {
  try {
    const { streamId } = req.params;
    const { status, page = 1, limit = 20, organizationId } = req.query;

    const query = { streamId, ...activeFilter(req) };
    if (organizationId) query.organization = organizationId;
    if (status) {
      query.status = status;
    }

    const clips = await Clip.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Clip.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        clips,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get Clips Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch clips",
      error: error.message,
    });
  }
};

// Get clip by ID
const getClipById = async (req, res) => {
  try {
    const { clipId } = req.params;

    const clip = await Clip.findOne({ ...clipIdQuery(clipId), ...activeFilter(req) });
    if (!clip) {
      return res.status(404).json({
        success: false,
        message: "Clip not found",
      });
    }

    res.status(200).json({
      success: true,
      data: clip,
    });
  } catch (error) {
    console.error("Get Clip Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch clip",
      error: error.message,
    });
  }
};

// Update clip with AI completion data
const updateClipWithAIResponse = async (req, res) => {
  try {
    const { clipId } = req.params;
    const aiResponse = req.body;

    console.log(`Updating clip ${clipId} with AI response:`, aiResponse);

    // Find the clip
    const clip = await Clip.findOne({ id: clipId });
    if (!clip) {
      return res.status(404).json({
        success: false,
        message: "Clip not found",
      });
    }

    // Update clip with AI response data
    if (aiResponse.status === "completed") {
      clip.status = 1; // 1 = published/completed (Number as per schema)
      clip.clipStatus = "COMPLETED"; // String enum for completed status
      clip.progress = aiResponse.percent || 100;
      clip.videoUrl = aiResponse.video_url || "";
      clip.thumbnailUrl = aiResponse.thumbnail || "";
      clip.thumbnails = aiResponse.thumbnails || [];
    } else if (aiResponse.status === "failed") {
      // Do not persist failed clips; remove the record
      try {
        await Clip.updateOne({ _id: clip._id }, { $set: getSoftDeleteStamp(req) });
      } catch (delErr) {
        logger.error("Failed to remove failed clip via update API:", delErr);
      }
      writeMonitorLog(
        {
          action: "api_failure",
          entity: "clip",
          entityId: clip.id || clip._id?.toString(),
          orgId: clip.organization ?? null,
          metadata: {
            source: "updateClipWithAIResponse",
            reason: "AI reported failed",
            clipId,
          },
        },
        req,
      );
      return res
        .status(200)
        .json({ success: true, message: "Clip failed and removed" });
    } else if (aiResponse.percent !== undefined) {
      clip.progress = Math.min(100, Math.max(0, aiResponse.percent));
    }

    // Store the complete AI response
    clip.aiServerResponse = { ...clip.aiServerResponse, ...aiResponse };
    await clip.save();

    if (aiResponse.status === "completed") {
      writeMonitorLog(
        {
          action: "ai_push",
          entity: "clip",
          entityId: clip.id || clip._id?.toString(),
          orgId: clip.organization ?? null,
          metadata: {
            source: "updateClipWithAIResponse",
            clipId,
            hasVideoUrl: !!aiResponse.video_url,
            percent: aiResponse.percent,
          },
        },
        req,
      );
    }

    res.status(200).json({
      success: true,
      message: "Clip updated successfully",
      data: clip,
    });
  } catch (error) {
    console.error("Update Clip Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update clip",
      error: error.message,
    });
  }
};

// Get clip progress by job ID
const getClipProgress = async (req, res) => {
  try {
    const { job_id } = req.query;

    if (!job_id) {
      return res.status(400).json({
        status: "error",
        message: "job_id parameter is required",
      });
    }

    // Find clip by jobId
    const clip = await Clip.findOne({ jobId: job_id });

    if (!clip) {
      return res.status(404).json({
        status: "error",
        message: "Clip not found for the provided job_id",
      });
    }

    // If clip is already completed or failed, return stored data
    if (clip.status === "completed") {
      return res.json({
        status: "completed",
        progress: 100,
        job_id: clip.jobId,
        videoUrl: clip.videoUrl,
        thumbnail: clip.thumbnailUrl,
        thumbnails: clip.thumbnails || [],
      });
    }

    if (clip.status === "failed") {
      return res.json({
        status: "failed",
        progress: clip.progress || 0,
        job_id: clip.jobId,
        error: clip.errorMessage || "Clip generation failed",
      });
    }

    // Fetch real-time progress from AI server
    try {
      const hostCP = await resolveHostByJobId(job_id);
      const aiResponse = await axios.get(
        `${AI_SERVER_URL(hostCP)}/progress?job_id=${job_id}`,
      );
      const aiData = aiResponse.data || {};
      const { percent, status, thumbnail, thumbnails, video_url, transcript } =
        aiData;

      // Update clip progress in database
      clip.progress = percent;

      // If completed (100%), update clip with final data
      if (percent === 100 && status === "completed") {
        clip.status = 1; // 1 = published/completed (Number as per schema)
        clip.clipStatus = "COMPLETED"; // String enum for completed status
        clip.videoUrl = video_url;
        clip.thumbnailUrl = thumbnail;
        clip.thumbnails = thumbnails || [];
        if (transcript && typeof transcript === "string" && transcript.trim()) {
          clip.description = transcript;
        }

        // Handle vertical_data if present or if sport is cricket
        const verticalData = aiData.vertical_data || {};
        const sport = aiData.sport || "";
        logger.info(
          `[getClipProgress] Completion data - status: ${status}, sport: ${sport}, has vertical_data: ${
            Object.keys(verticalData).length > 0
          }`,
        );
        if (
          (verticalData && Object.keys(verticalData).length > 0) ||
          sport?.toLowerCase() === "cricket"
        ) {
          logger.info(
            `[getClipProgress] Adding vertical data to editedVideos for job ${job_id}`,
          );
          const uid = uuidv4();
          const editedVideoObj = {
            documentId: uid.replace(/-/g, ""),
            aspect_ratio: "9:16",
            // uid,
            event: "autoFlip",
            id: uuidv4(),
            clipType: "clip",
            folderId: clip.folderId || "",
            duration: verticalData.duration_autoflip || clip.duration || 0,
            videoUrl: verticalData.autoflip_url || aiData.video_url || "",
            thumbnails: verticalData.thumbnail_autoflip
              ? verticalData.thumbnail_autoflip
              : aiData.thumbnails || [],
            thumbnailUrl: verticalData.thumbnail_autoflip
              ? Array.isArray(verticalData.thumbnail_autoflip)
                ? verticalData.thumbnail_autoflip[0]
                : verticalData.thumbnail_autoflip
              : aiData.thumbnail || "",
            status: "completed",
          };
          if (!clip.editedVideos) {
            clip.editedVideos = [];
          }
          clip.editedVideos.push(editedVideoObj);
        }

        await clip.save();

        writeMonitorLog(
          {
            action: "ai_push",
            entity: "clip",
            entityId: clip.id || clip._id?.toString(),
            orgId: clip.organization ?? null,
            metadata: {
              source: "getClipProgress",
              job_id,
              clipId: clip.id,
              percent: 100,
              hasVideoUrl: !!video_url,
            },
          },
          req,
        );

        return res.json({
          status: "completed",
          progress: 100,
          job_id: clip.jobId,
          videoUrl: video_url,
          thumbnail: thumbnail,
          thumbnails: thumbnails || [],
        });
      }

      // If failed
      if (status === "failed") {
        // Do not persist failed clips; remove the record
        try {
          await Clip.updateOne({ _id: clip._id }, { $set: getSoftDeleteStamp(req) });
        } catch (delErr) {
          logger.error(
            "Failed to remove failed clip via progress API:",
            delErr,
          );
        }
        writeMonitorLog(
          {
            action: "api_failure",
            entity: "clip",
            entityId: clip.id || clip._id?.toString(),
            orgId: clip.organization ?? null,
            metadata: {
              source: "getClipProgress",
              reason: "AI reported failed",
              job_id,
              clipId: clip.id,
              percent,
            },
          },
          req,
        );
        return res.json({
          status: "failed",
          progress: percent,
          job_id: clip.jobId,
          error: "AI processing failed",
        });
      }

      // Save progress update
      await clip.save();

      // Return current progress
      return res.json({
        status: "processing",
        progress: percent,
        job_id: clip.jobId,
      });
    } catch (aiError) {
      logger.error("Error fetching progress from AI server:", aiError);

      // Fallback to stored progress if AI server is unreachable
      const currentStatus =
        clip.status === "completed"
          ? "completed"
          : clip.status === "failed"
            ? "failed"
            : "processing";

      const response = {
        status: currentStatus,
        progress: clip.progress || 0,
        job_id: clip.jobId,
      };

      if (currentStatus === "completed") {
        response.video_url = clip.videoUrl;
        response.thumbnail = clip.thumbnailUrl;
        response.thumbnails = clip.thumbnails || [];
      }

      if (currentStatus === "failed") {
        response.error = clip.errorMessage || "Clip generation failed";
      }

      return res.json(response);
    }
  } catch (error) {
    logger.error("Error getting clip progress:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

// Avoid passing non-ObjectId strings to _id (causes CastError for UUIDs from media library)
const isMongoId = (str) =>
  typeof str === "string" && /^[a-fA-F0-9]{24}$/.test(str);

// Update clip by ID (for title, rating, tags)
const updateClip = async (req, res) => {
  try {
    const { clipId } = req.params;
    const updateData = req.body;

    if (!clipId) {
      return res.status(400).json({
        success: false,
        message: "Clip ID is required",
      });
    }

    const query = isMongoId(clipId)
      ? { $or: [{ _id: clipId }, { id: clipId }], ...activeFilter(req) }
      : { id: clipId, ...activeFilter(req) };
    let clip = await Clip.findOne(query);

    if (!clip) {
      return res.status(404).json({
        success: false,
        message: "Clip not found",
      });
    }

    if (updateData.title !== undefined) {
      clip.title = updateData.title;
    }
    if (updateData.rating !== undefined) {
      clip.rating = updateData.rating;
    }
    if (updateData.description !== undefined) {
      clip.description = updateData.description;
    }
    if (updateData.tags !== undefined) {
      clip.tags = Array.isArray(updateData.tags) ? updateData.tags : [];
    }
    if (updateData.clip_ai_score !== undefined) {
      if (!clip.customData || typeof clip.customData !== "object") {
        clip.customData = {};
      }
      clip.customData.clip_ai_score = updateData.clip_ai_score;
    }
    Object.assign(clip, getAuditStamp(req));

    await clip.save();
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "clip",
      entityId: clip.id || clip._id?.toString(),
      orgId: clip.organization || null,
      metadata: { fields: Object.keys(updateData || {}) },
    });

    res.status(200).json({
      success: true,
      message: "Clip updated successfully",
      data: clip,
    });
  } catch (error) {
    console.error("Update Clip Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update clip",
      error: error.message,
    });
  }
};

// Export clip as JSON payload
const exportClipJson = async (req, res) => {
  try {
    const { clipId } = req.params;
    if (!clipId) {
      return res
        .status(400)
        .json({ success: false, message: "clipId is required" });
    }
    const clip = await Clip.findOne(clipIdQuery(clipId));
    if (!clip) {
      return res
        .status(404)
        .json({ success: false, message: "Clip not found" });
    }
    const data = {
      id: clip.id || clip._id?.toString(),
      streamId: clip.streamId,
      title: clip.title,
      start_time: clip.start_time,
      end_time: clip.end_time,
      duration: clip.duration,
      aspect_ratio: clip.aspectRatio,
      rating: clip.rating,
      tags: Array.isArray(clip.tags) ? clip.tags : [],
      videoUrl: clip.videoUrl,
      thumbnailUrl: clip.thumbnailUrl,
      thumbnails: Array.isArray(clip.thumbnails) ? clip.thumbnails : [],
      status: clip.clipStatus,
      progress: clip.progress,
      description: clip.description || "",
      userId: clip.userId || "",
      customData: clip.customData || {},
      editedVideos: Array.isArray(clip.editedVideos) ? clip.editedVideos : [],
      createdAt: clip.createdAt,
      updatedAt: clip.updatedAt,
    };
    return res
      .status(200)
      .json({ success: true, data, message: "Export clip json successfully" });
  } catch (error) {
    logger.error("[exportClipJson] Error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to export clip json",
        error: error.message,
      });
  }
};

// Delete clip by ID
const deleteClip = async (req, res) => {
  try {
    const { clipId } = req.params;

    // Validate that we have an ID
    if (!clipId) {
      return res.status(400).json({
        success: false,
        message: "Clip ID is required",
      });
    }

    let clip = await Clip.findOneAndUpdate(
      { ...clipIdQuery(clipId), isDeleted: { $ne: true } },
      { $set: getSoftDeleteStamp(req) },
      { new: true },
    );

    if (!clip) {
      return res.status(404).json({
        success: false,
        message: "Clip not found",
      });
    }

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "delete",
      entity: "clip",
      entityId: clip.id || clip._id?.toString(),
      orgId: clip.organization || null,
    });
    invalidateMediaLibraryListCache();
    res.status(200).json({
      success: true,
      message: "Clip soft deleted successfully",
      data: { id: clip._id },
    });
  } catch (error) {
    console.error("Delete Clip Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete clip",
      error: error.message,
    });
  }
};

export {
  generateClip,
  handleWebhook,
  getClips,
  getClipById,
  updateClipWithAIResponse,
  getClipProgress,
  generateClipHighlight,
  clipHighlightWebhook,
  getClipHighlightProgressByJobId,
  resetClipHighlightStatus,
  overwriteClipById,
  saveClipAsNew,
  generateInputRatioClip,
  zantagDynamicCropper,
  saveClipFromFolder,
  updateClip,
  deleteClip,
  deleteEditedClip,
  exportClipJson,
};

// AI Scene webhook (save clips pushed by AI)
export const aiSceneWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];
    const { emitWebhookUpdate } = await import("../socket/index.js");

    const sanitizeUrl = (u) => {
      if (typeof u !== "string") return "";
      return u.replace(/`/g, "").trim();
    };
    const parseThumbs = (t) => {
      if (!t) return [];
      if (Array.isArray(t)) return t.map(sanitizeUrl).filter(Boolean);
      if (typeof t === "string") {
        try {
          const asJson = t.replace(/`/g, "").replace(/'/g, '"');
          const arr = JSON.parse(asJson);
          if (Array.isArray(arr)) return arr.map(sanitizeUrl).filter(Boolean);
        } catch {}
        return [sanitizeUrl(t)];
      }
      return [];
    };

    const saved = [];
    for (const it of items) {
      const streamId = it.streamId || it.stream_id || "";
      const title = it.clip_ai_title || it.title || "";
      const duration = Number(it.duration || 0) || 0;
      const start_time = typeof it.start_time === "string" ? it.start_time : "";
      const end_time = typeof it.end_time === "string" ? it.end_time : "";
      const aspectRatio = it.aspect_ratio || "16:9";
      const rating = Number(it.rating_ai || 1) || 1;
      const videoUrl = sanitizeUrl(it.url || it.video_url || "");
      const description =
        typeof it.clip_ai_transcribe === "string" ? it.clip_ai_transcribe : "";
      const thumbnailUrl = sanitizeUrl(it.thumbnailUrl || it.thumbnail || "");
      const thumbnails = parseThumbs(it.thumbnails);
      const id = uuidv4();

      // Build tags from players/outcome/explicit tags
      const playersArr = Array.isArray(it.players)
        ? it.players.map((s) => String(s).trim()).filter(Boolean)
        : it.players
          ? String(it.players)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const outcomeArr = Array.isArray(it.clip_ai_outcome)
        ? it.clip_ai_outcome.map((s) => String(s).trim()).filter(Boolean)
        : typeof it.clip_ai_outcome === "string"
          ? String(it.clip_ai_outcome)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const explicitTags = Array.isArray(it.tags)
        ? it.tags.map((s) => String(s).trim()).filter(Boolean)
        : typeof it.tags === "string"
          ? String(it.tags)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const tags = [...playersArr, ...outcomeArr, ...explicitTags].filter(
        Boolean,
      );
      const isAITagged = tags.length > 0;

      // Resolve userId from stream
      let resolvedUserId = "";
      if (streamId) {
        try {
          const streamDoc = await Stream.findOne({ streamId }).lean();
          resolvedUserId = streamDoc?.userId || streamDoc?.createdBy || "";
        } catch (e) {
          logger.warn(
            `[aiSceneWebhook] Unable to resolve stream userId for streamId=${streamId}: ${e?.message || e}`,
          );
        }
      }

      const organizationId = resolvedUserId
        ? await getOrgIdByUserId(resolvedUserId)
        : null;

      const clipDoc = new Clip({
        streamId,
        id,
        title,
        start_time,
        end_time,
        duration,
        rating,
        tags,
        userId: resolvedUserId,
        aspectRatio,
        status: 1,
        clipStatus: "COMPLETED",
        videoUrl,
        thumbnailUrl,
        thumbnails,
        progress: 100,
        description,
        isAITagged,
        isAiCreated: true,
        isManual: false,
        aiSceneId: it.aiSceneId || "",
        type: "clip",
        aiTitle: title ? { title } : {},
        // description: typeof it.clip_ai_transcribe === 'string' ? it.clip_ai_transcribe : '',
        customData: {
          sportName: it.sport || "",
          aiSceneId: it.aiSceneId || "",
          scene_no: it.scene_no || "",
          label: it.label || "",
          players: playersArr,
          clip_ai_outcome: outcomeArr.join(", "),
          clip_ai_score: it.clip_ai_score || "",
          timestamp: it.timestamp || "",
        },
      });
      if (organizationId) clipDoc.organization = organizationId;

      await clipDoc.save();
      saved.push({
        id: clipDoc.id,
        streamId: clipDoc.streamId,
        title: clipDoc.title,
      });

      writeAuditLog({
        ...buildBaseAuditFromRequest(req),
        action: "create",
        entity: "clip",
        entityId: clipDoc.id || clipDoc._id?.toString(),
        orgId: organizationId ?? null,
        metadata: { source: "aiSceneWebhook", streamId, aiSceneId: it.aiSceneId },
      });
    }

    try {
      emitWebhookUpdate({
        type: "ai-scenes",
        streamId: saved[0]?.streamId || "",
        items: saved,
      });
    } catch {}

    return res
      .status(201)
      .json({ success: true, message: "AI scenes saved", data: saved });
  } catch (error) {
    logger.error("[aiSceneWebhook] Error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to save AI scene clips",
        error: error.message,
      });
  }
};

export const aiAutoflipWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];
    const { emitWebhookUpdate } = await import("../socket/index.js");

    const sanitizeUrl = (u) => {
      if (typeof u !== "string") return "";
      return u.replace(/`/g, "").trim();
    };
    const parseThumbs = (t) => {
      if (!t) return [];
      if (Array.isArray(t)) return t.map(sanitizeUrl).filter(Boolean);
      if (typeof t === "string") {
        try {
          const asJson = t.replace(/`/g, "").replace(/'/g, '"');
          const arr = JSON.parse(asJson);
          if (Array.isArray(arr)) return arr.map(sanitizeUrl).filter(Boolean);
        } catch {}
        return [sanitizeUrl(t)];
      }
      return [];
    };

    const updates = [];
    for (const it of items) {
      const streamId = String(it.streamId || it.stream_id || "").trim();
      const aiSceneId = String(it.aiSceneId || it.ai_scene_id || "").trim();
      const aspect_ratio = String(it.aspect_ratio || "9:16").trim();
      const videoUrl = sanitizeUrl(it.url || it.video_url || "");
      const thumbnailUrl = sanitizeUrl(it.thumbnailUrl || it.thumbnail || "");
      const thumbnails = parseThumbs(it.thumbnails);

      if (!streamId || !aiSceneId) continue;

      const clip = await Clip.findOne({
        streamId,
        $or: [{ "customData.aiSceneId": aiSceneId }, { aiSceneId: aiSceneId }],
      });

      if (!clip) continue;

      const edited = {
        documentId: clip._id?.toString() || "",
        aspect_ratio,
        event: "autoFlip",
        id: uuidv4(),
        clipType: "clip",
        folderId: "",
        duration: Number(clip.duration || 0),
        videoUrl,
        thumbnails,
        thumbnailUrl,
        status: "completed",
      };

      const existingIdx = (clip.editedVideos || []).findIndex(
        (ev) =>
          String(ev?.aspect_ratio) === aspect_ratio &&
          String(ev?.event) === "autoFlip",
      );
      if (existingIdx >= 0) {
        clip.editedVideos[existingIdx] = {
          ...clip.editedVideos[existingIdx],
          ...edited,
        };
      } else {
        clip.editedVideos = [...(clip.editedVideos || []), edited];
      }
      // clip.editedPreviewUrl = videoUrl || clip.editedPreviewUrl || '';
      await clip.save();
      updates.push({ id: clip.id, streamId, aiSceneId, aspect_ratio });

      writeAuditLog({
        ...buildBaseAuditFromRequest(req),
        action: "update",
        entity: "clip",
        entityId: clip.id || clip._id?.toString(),
        orgId: clip.organization ?? null,
        metadata: {
          source: "aiAutoflipWebhook",
          aspect_ratio,
          aiSceneId,
        },
      });
    }

    try {
      const streamIdForEmit = updates[0]?.streamId || "";
      emitWebhookUpdate({
        type: "autoflip",
        streamId: streamIdForEmit,
        items: updates,
      });
    } catch {}

    return res
      .status(200)
      .json({
        success: true,
        message: "AutoFlip scenes applied",
        data: updates,
      });
  } catch (error) {
    logger.error("[aiAutoflipWebhook] Error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to apply AutoFlip scenes",
        error: error.message,
      });
  }
};

// Overwrite clip with edited preview data
const overwriteClipById = async (req, res) => {
  try {
    const { clipId } = req.params;
    if (!clipId)
      return res
        .status(400)
        .json({ success: false, message: "clipId is required" });
    const clip = await Clip.findOne(clipIdQuery(clipId));
    if (!clip)
      return res
        .status(404)
        .json({ success: false, message: "Clip not found" });

    const previewUrl =
      clip.editedPreviewUrl || clip.editedClipData?.previewUrl || "";
    if (!previewUrl)
      return res.status(400).json({
        success: false,
        message: "No edited preview available to overwrite",
      });

    const thumbnails = clip.editedClipData?.thumbnails || clip.thumbnails || [];
    const thumbnail =
      clip.editedClipData?.thumbnail ||
      thumbnails?.[0] ||
      clip.thumbnailUrl ||
      "";
    const dura = clip.editedClipData?.duration || clip.duration || 0;
    const aspect =
      clip.editedClipData?.aspect_ratio || clip.aspectRatio || "16:9";

    clip.videoUrl = previewUrl;
    clip.thumbnailUrl = thumbnail;
    clip.thumbnails = Array.isArray(thumbnails)
      ? thumbnails
      : thumbnail
        ? [thumbnail]
        : [];
    clip.duration = typeof dura === "number" ? dura : clip.duration;
    clip.aspectRatio = aspect;
    clip.progress = 100;
    clip.status = 1;
    clip.clipStatus = "COMPLETED";
    await clip.save();

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "clip",
      entityId: clip.id || clip._id?.toString(),
      orgId: clip.organization ?? null,
      metadata: { source: "overwriteClipById" },
    });

    return res.status(200).json({
      success: true,
      message: "Clip overwritten successfully",
      data: { id: clip.id, videoUrl: clip.videoUrl },
    });
  } catch (error) {
    logger.error("[overwriteClipById] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to overwrite clip",
      error: error.message,
    });
  }
};

// Save edited preview as a new clip
const saveClipAsNew = async (req, res) => {
  try {
    const { sourceClipId, title, aspectRatio, documentId } = req.body || {};
    if (!sourceClipId || !title)
      return res.status(400).json({
        success: false,
        message: "sourceClipId and title are required",
      });
    const src = await Clip.findOne({
      $or: [{ id: sourceClipId }, { _id: sourceClipId }],
    });
    if (!src)
      return res
        .status(404)
        .json({ success: false, message: "Source clip not found" });

    let videoUrl =
      src.editedPreviewUrl ||
      src.editedClipData?.previewUrl ||
      src.videoUrl ||
      "";
    if (!videoUrl)
      return res.status(400).json({
        success: false,
        message: "No preview available to save as new clip",
      });

    // If documentId provided, prefer editedVideos entry
    let ev = null;
    if (documentId && Array.isArray(src?.editedVideos)) {
      ev = src.editedVideos.find(
        (v) => String(v?.documentId || v?.id) === String(documentId),
      );
      if (ev) {
        videoUrl = ev?.videoUrl || videoUrl;
      }
    }

    const organizationId =
      (await getCurrentUserOrgId(req)) || src.organization || null;

    const newId = uuidv4();
    const newClip = new Clip({
      streamId: src.streamId,
      id: newId,
      title,
      start_time: src.start_time,
      end_time: src.end_time,
      duration:
        ev?.duration || src.editedClipData?.duration || src.duration || 0,
      rating: src.rating || 1,
      tags: src.tags || [],
      userId: src.userId || "",
      aspectRatio:
        aspectRatio ||
        ev?.aspect_ratio ||
        src.editedClipData?.aspect_ratio ||
        src.aspectRatio ||
        "16:9",
      status: 1,
      clipStatus: "COMPLETED",
      videoUrl,
      thumbnailUrl:
        ev?.thumbnailUrl ||
        src.editedClipData?.thumbnail ||
        src.thumbnailUrl ||
        "",
      thumbnails:
        (Array.isArray(ev?.thumbnails) ? ev.thumbnails : undefined) ||
        src.editedClipData?.thumbnails ||
        src.thumbnails ||
        [],
      progress: 100,
      customData: src.customData || {},
    });
    if (organizationId) newClip.organization = organizationId;
    await newClip.save();

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "create",
      entity: "clip",
      entityId: newClip.id || newClip._id?.toString(),
      orgId: organizationId ?? newClip.organization ?? null,
      metadata: { source: "saveClipAsNew", sourceClipId },
    });

    return res.status(201).json({
      success: true,
      message: "New clip created",
      data: { id: newClip.id },
    });
  } catch (error) {
    logger.error("[saveClipAsNew] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save new clip",
      error: error.message,
    });
  }
};
// Dynamic cropper via AI 5004
const zantagDynamicCropper = async (req, res) => {
  try {
    const {
      videoUrl,
      streamId,
      coordinates,
      clipTitle,
      clipId,
      event,
      aspectRatio,
    } = req.body || {};
    if (
      !videoUrl ||
      !clipId ||
      !Array.isArray(coordinates) ||
      coordinates.length === 0
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "videoUrl, clipId and coordinates are required",
        });
    }

    const payload = {
      videoUrl,
      streamId,
      coordinates,
      clipTitle,
      clipId,
      event,
      aspectRatio,
    };
    const host = await resolveHostByStreamId(streamId);
    const aiResp = await axios.post(
      `http://${host || DEFAULT_AI_HOST}:5004/zantag_dynamic_cropper`,
      payload,
      {
        timeout: 60000,
        headers: { "Content-Type": "application/json" },
      },
    );
    const aiData = aiResp?.data || {};
    const result = aiData?.result || {};

    // Update clip saved versions inside editedVideos
    const clip = await Clip.findOne(clipIdQuery(clipId));
    if (clip) {
      const uid = uuidv4();
      const thumbs = Array.isArray(result?.thumnial)
        ? result.thumnial
        : result?.thumnials
          ? [result.thumnials]
          : Array.isArray(result?.thumbnail)
            ? result.thumbnail
            : result?.thumbnail
              ? [result.thumbnail]
              : [];
      const statusVal =
        aiData?.status === "200" ||
        aiData?.status === "success" ||
        result?.status === "success" ||
        result?.status === "completed"
          ? "completed"
          : "processing";
      const editedVideoObj = {
        documentId: uid.replace(/-/g, ""),
        aspect_ratio:
          result?.aspect_ratio || aspectRatio || clip.aspectRatio || "16:9",
        event: "dynamicCropped",
        id: clip.id || clip._id?.toString(),
        clipType: "clip",
        folderId: clip.folderId || "",
        isDynamicCropped: true,
        duration: clip.duration || 0,
        videoUrl: result?.video_url || "",
        thumbnails: thumbs,
        thumbnailUrl: thumbs[0] || "",
        status: statusVal,
      };
      await Clip.findByIdAndUpdate(clip._id, {
        $push: { editedVideos: editedVideoObj },
      });

      writeAuditLog({
        ...buildBaseAuditFromRequest(req),
        action: "update",
        entity: "clip",
        entityId: clip.id || clip._id?.toString(),
        orgId: clip.organization ?? null,
        metadata: {
          source: "zantagDynamicCropper",
          event: "dynamicCropped",
          aspect_ratio: editedVideoObj.aspect_ratio,
        },
      });
    }

    return res
      .status(200)
      .json({
        success: true,
        data: aiData,
        message: "Dynamic cropper completed",
      });
  } catch (error) {
    logger.error("[zantagDynamicCropper] Error:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to run dynamic cropper",
        error: error.message,
      });
  }
};
