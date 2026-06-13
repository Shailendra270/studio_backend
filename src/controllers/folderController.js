import clipList from "../models/Folder.js";
import Clip from "../models/Clip.js";
import Stream from "../models/Stream.js";
import { resolveHostByStreamId, resolveHostByJobId } from "../utils/aiHost.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";
import { getCurrentUserOrgId } from "../utils/organizationHelper.js";
import { activeFilter } from "../utils/softDelete.js";
import { getAuditStamp, getSoftDeleteStamp } from "../utils/requestContext.js";
import { buildBaseAuditFromRequest, writeAuditLog, writeMonitorLog } from "../services/auditLogService.js";
import { invalidateMediaLibraryListCache } from "./mediaLibraryController.js";

// Create a new folder
const createFolder = async (req, res) => {
  try {
    const { streamId, type, title, aspectRatio, clips, userId, category } =
      req.body;

    // Validate required fields
    if (!userId || !type) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, type",
      });
    }

    const organizationId = await getCurrentUserOrgId(req);

    // Validate clips array if provided
    if (clips && Array.isArray(clips)) {
      for (const clip of clips) {
        if (
          typeof clip === "object" &&
          clip !== null &&
          !mongoose.Types.ObjectId.isValid(clip)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Clips array must contain valid ObjectId references, not objects",
          });
        }
      }
    }

    const isAiCreatedInput = req.body?.isAiCreated ?? req.body?.isAICreated;
    const isAiCreated =
      typeof isAiCreatedInput === "boolean"
        ? isAiCreatedInput
        : Boolean(isAiCreatedInput);

    let folderData = {
      userId,
      ...(organizationId && { organization: organizationId }),
      type,
      aspectRatio,
      streamId,
      title,
      category,
      isAiCreated,
    };

    if (streamId) {
      // Find and update stream folder count
      const stream = await Stream.findOne({ streamId });
      if (stream) {
        await Stream.findOneAndUpdate(
          { streamId },
          { $inc: { clipFolderCount: 1 } },
        );

        folderData = {
          ...folderData,
          streamId,
          title: title || `Untitled ${(stream.clipFolderCount || 0) + 1}`,
          clips: clips || [],
        };
      } else {
        folderData = {
          ...folderData,
          streamId,
          title: title || "Untitled 1",
          clips: clips || [],
        };
      }
    } else {
      folderData = {
        ...folderData,
        title,
        clips: clips || [],
      };
    }

    logger.info("[create_folder] Creating folder", { data: { folderData } });
    const newFolder = await clipList.create(folderData);
    await newFolder.populate("clips");
    logger.info("[create_folder] Folder created successfully", {
      folderId: newFolder._id,
    });

    return res.status(201).json({
      success: true,
      data: newFolder,
      message: "Highlight Folder created successfully!",
    });
  } catch (error) {
    if (error.code === 11000) {
      logger.info("[create_folder] Title already exists", { data: req.body });
      return res.status(400).json({
        success: false,
        message: "Title already exists",
      });
    } else if (error.name === "ValidationError") {
      logger.info("[create_folder] Validation error", {
        data: req.body,
        error: error.message,
      });
      return res.status(400).json({
        success: false,
        message: "Validation error: " + error.message,
      });
    } else if (error.name === "CastError") {
      logger.info("[create_folder] Invalid data format", {
        data: req.body,
        error: error.message,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid data format: " + error.message,
      });
    } else {
      logger.error("[create_folder] Something went wrong", {
        data: req.body,
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }
};

// Proxy: Create AI highlight via AI server (5005) and update folder
const createAIHighlightProxy = async (req, res) => {
  try {
    const {
      sports,
      competition,
      event,
      stream_id,
      duration_request,
      events_request,
      player,
      replay_request,
      highlight_id,
      intro,
      outro,
      aspect_ratio,
      clips,
    } = req.body || {};

    if (!highlight_id) {
      return res.status(400).json({
        success: false,
        message: "highlight_id (folderId) is required",
      });
    }

    // Validate folder
    const folder = await clipList.findOne({ _id: highlight_id, ...activeFilter(req) });
    if (!folder) {
      return res
        .status(404)
        .json({ success: false, message: "Folder not found" });
    }

    const hasEvents = typeof events_request !== "undefined";
    const use5000 = hasEvents; // events_request -> 5000
    const targetPort = hasEvents ? 5000 : 5005;

    // Prepare update object
    const updateData = {
      isPreview: true,
      previewUrl: "",
      aiServerPort: targetPort,
      progressPercent: 0,
      highlightInitiatedAt: new Date(),
      status: "processing",
    };

    // Add streamId if provided and not already set
    if (stream_id && !folder.streamId) {
      updateData.streamId = stream_id;
    }

    // Mark folder as processing with single update
    await clipList.findByIdAndUpdate(
      highlight_id,
      { $set: updateData },
      { new: true },
    );

    // Build payload per target server expectations
    const aiPayload = use5000
      ? {
          sports,
          competition,
          event,
          stream_id,
          events_request,
          player: Array.isArray(player) ? player : [],
          replay_request,
          highlight_id,
          intro,
          outro,
          aspect_ratio,
          clips,
        }
      : {
          sports,
          competition,
          event,
          stream_id,
          duration_request,
          replay_request,
          highlight_id,
          intro,
          outro,
          aspect_ratio,
          clips,
        };

    // Forward request to correct AI server
    const host = await resolveHostByStreamId(stream_id);
    const aiResponse = await fetch(
      `http://${host}:${targetPort}/get_ai_highlight`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiPayload),
      },
    );

    const aiResult = await aiResponse.json();
    if (!aiResponse.ok) {
      logger.error("AI server error (create)", aiResult);
      return res.status(aiResponse.status).json({
        success: false,
        message: aiResult?.message || "AI server error",
        data: aiResult,
      });
    }

    // Persist initial AI response
    // Handle unique title constraint: streamId + title + type must be unique
    let safeTitle = folder.title;
    if (aiResult?.ai_title) {
      const conflict = await clipList.findOne({
        streamId: stream_id || folder.streamId,
        title: aiResult.ai_title,
        type: folder.type || "clip",
      });
      safeTitle = conflict
        ? `${aiResult.ai_title} - ${String(highlight_id).slice(-6)}`
        : aiResult.ai_title;
    }

    const newUpdateData = {
      rating: aiResult?.ai_rating ?? folder.rating,
      status: aiResult?.status ?? "processing",
      isAiCreated: true,
      jobId: aiResult?.job_id ?? folder.jobId,
      aiServerPort: targetPort,
    };

    // Only set title if provided (and after conflict resolution)
    if (aiResult?.ai_title) {
      newUpdateData.title = safeTitle;
    }

    await clipList.findByIdAndUpdate(highlight_id, { $set: newUpdateData });

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "folder",
      entityId: highlight_id,
      orgId: folder.organization ?? null,
      metadata: {
        source: "createAIHighlightProxy",
        durationBased: !use5000,
        eventsBased: use5000,
        targetPort,
      },
    });

    return res.status(200).json({
      success: true,
      message: "AI highlight creation initiated",
      data: aiResult,
    });
  } catch (error) {
    logger.error("[createAIHighlightProxy] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate AI highlight",
      error: error.message,
    });
  }
};

// Proxy: Get AI highlight progress and update folder details
const getAIHighlightProgressProxy = async (req, res) => {
  try {
    const { highlight_id } = req.query;
    if (!highlight_id) {
      return res
        .status(400)
        .json({ success: false, message: "highlight_id is required" });
    }

    // Determine which AI server to query for progress
    const folder = await clipList.findOne({ _id: highlight_id, ...activeFilter(req) });
    const targetPort = folder?.aiServerPort
      ? Number(folder.aiServerPort)
      : 5000;
    const host4 = await resolveHostByStreamId(folder?.streamId);

    const aiResponse = await fetch(
      `http://${host4}:${targetPort}/progress?highlight_id=${encodeURIComponent(
        highlight_id,
      )}`,
    );

    const aiResult = await aiResponse.json();
    if (!aiResponse.ok) {
      logger.error("AI server error (progress)", aiResult);
      writeMonitorLog(
        {
          action: "api_failure",
          entity: "highlight",
          entityId: highlight_id,
          orgId: folder?.organization ?? null,
          statusCode: aiResponse.status,
          metadata: {
            source: "getAIHighlightProgressProxy",
            reason: "AI progress request failed",
            message: aiResult?.message,
            percent: aiResult?.percent,
          },
        },
        req,
      );
      return res.status(aiResponse.status).json({
        success: false,
        message: aiResult?.message || "AI server error",
        data: aiResult,
      });
    }

    // Update folder with progress
    const updateData = {
      progressPercent: aiResult?.percent ?? 0,
      status: aiResult?.status ?? "processing",
    };

    // On completion, persist final details
    if (aiResult?.status === "completed" && aiResult?.percent === 100) {
      // Extract scene_id list and filter to valid ObjectIds only
      let clipIdsRaw = [];
      if (Array.isArray(aiResult?.all_info)) {
        clipIdsRaw = aiResult.all_info
          .map((info) => info?.scene_id)
          .filter(Boolean);
      } else if (Array.isArray(aiResult?.clips)) {
        clipIdsRaw = aiResult.clips.filter(Boolean);
      }

      const clipObjectIds = clipIdsRaw
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const droppedIds = clipIdsRaw.filter(
        (id) => !mongoose.Types.ObjectId.isValid(id),
      );
      if (droppedIds.length > 0) {
        writeMonitorLog(
          {
            action: "missing_objects",
            entity: "highlight",
            entityId: highlight_id,
            orgId: folder?.organization ?? null,
            metadata: {
              source: "getAIHighlightProgressProxy",
              reason: "Invalid or non-ObjectId clip IDs dropped",
              droppedCount: droppedIds.length,
              droppedIds: droppedIds.slice(0, 50),
              rawCount: clipIdsRaw.length,
              acceptedCount: clipObjectIds.length,
            },
          },
          req,
        );
      }

      updateData.previewUrl = aiResult?.video_url || "";
      updateData.thumbnail = aiResult?.thumbnail || "";
      updateData.thumbnails = aiResult?.thumbnails || [];
      updateData.timeTaken = aiResult?.execution_time ?? 0;
      updateData.totalDuration = aiResult?.high_dura ?? 0;
      updateData.isPreview = true;

      // Only set clips if we have valid ObjectIds to avoid cast errors
      if (clipObjectIds.length > 0) {
        updateData.clips = clipObjectIds;
      }

      writeMonitorLog(
        {
          action: "ai_push",
          entity: "highlight",
          entityId: highlight_id,
          orgId: folder?.organization ?? null,
          metadata: {
            source: "getAIHighlightProgressProxy",
            highlight_id,
            clipsCount: clipObjectIds.length,
            rawClipsCount: clipIdsRaw.length,
            hasPreviewUrl: !!aiResult?.video_url,
            percent: aiResult?.percent,
          },
        },
        req,
      );
    }

    await clipList.findByIdAndUpdate(highlight_id, { $set: updateData });

    return res.status(200).json({ success: true, data: aiResult });
  } catch (error) {
    logger.error("[getAIHighlightProgressProxy] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch AI highlight progress",
      error: error.message,
    });
  }
};

// Update folder with clips or other properties
const updateFolder = async (req, res) => {
  try {
    const folderId = req.params.id;
    const updateData = req.body;

    // Validate folder ID
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid folder ID",
      });
    }

    // Handle clips array if provided
    if (updateData.clips && Array.isArray(updateData.clips)) {
      // Resolve clip IDs to ObjectIds (media library sends UUIDs in clip.id; Folder expects Clip _id)
      const clipObjectIds = await Promise.all(
        updateData.clips.map(async (clipId) => {
          const idStr = String(clipId).trim();
          if (mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
            return new mongoose.Types.ObjectId(idStr);
          }
          const clip = await Clip.findOne({ id: idStr }).select("_id").lean();
          if (!clip || !clip._id) {
            throw new Error(`Invalid clip ID: ${clipId}`);
          }
          return clip._id;
        }),
      );

    const updatedFolder = await clipList
        .findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(folderId), ...activeFilter(req) },
          { $set: { clips: clipObjectIds, ...getAuditStamp(req) } },
          { new: true },
        )
        .populate("clips");

      if (!updatedFolder) {
        logger.error("[update_folder] Folder not found", { folderId });
        return res.status(404).json({
          success: false,
          message: "Folder not found",
        });
      }

      logger.info("[update_folder] Folder updated with clips", {
        folderId,
        clipsUpdated: updateData.clips.length,
      });

      return res.status(200).json({
        success: true,
        data: updatedFolder,
        message: "Folder updated successfully",
      });
    }

    // Handle general folder updates
    const updatedFolder = await clipList
      .findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(folderId), ...activeFilter(req) },
        { $set: { ...updateData, ...getAuditStamp(req) } },
        { new: true },
      )
      .populate("clips");

    if (!updatedFolder) {
      logger.error("[update_folder] Folder not found", { folderId });
      return res.status(404).json({
        success: false,
        message: "Folder not found",
      });
    }

    logger.info("[update_folder] Folder updated successfully", {
      folderId,
      updateFields: Object.keys(updateData),
    });

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "folder",
      entityId: updatedFolder?._id?.toString(),
      orgId: updatedFolder?.organization || null,
      metadata: { fields: Object.keys(updateData || {}) },
    });
    return res.status(200).json({
      success: true,
      data: updatedFolder,
      message: "Folder updated successfully",
    });
  } catch (error) {
    if (error.message.includes("Invalid clip ID")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    logger.error("[update_folder] Something went wrong", {
      folderId: req.params.id,
      payload: req.body,
      error,
    });
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// Get all folders with enhanced filtering and pagination
const getFolders = async (req, res) => {
  try {
    const {
      userId,
      organizationId,
      streamId,
      type,
      page_no = "1",
      limit = "20",
      search,
      aspectRatio,
      rating,
      duration,
      sortBy,
      dateRange,
      category,
      isAiCreated,
    } = req.body || req.query;

    // Handle sortBy parameter
    let sortObject = { createdAt: -1 }; // default sort
    if (sortBy) {
      if (typeof sortBy === "string") {
        sortObject = { [sortBy]: -1 };
      } else if (typeof sortBy === "object") {
        sortObject = sortBy;
      }
    }

    let query = { ...activeFilter(req) };
    const orgIdForUser = await getCurrentUserOrgId(req);
    if (organizationId) {
      query.organization = organizationId;
    } else if (orgIdForUser) {
      query.organization = orgIdForUser;
    } else if (userId) {
      query.userId = userId;
    } else if (req.user?.userId) {
      query.userId = req.user.userId;
    }
    if (streamId) query.streamId = streamId;
    if (type) query.type = type;
    // Filter AI-created folders when explicitly requested
    if (typeof isAiCreated !== "undefined") {
      const aiFlag = isAiCreated === true || isAiCreated === "true";
      if (aiFlag) {
        query.isAiCreated = true;
      }
    }

    // Handle search functionality
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.title = { $regex: escapedSearch, $options: "i" };
    }

    // Handle additional filters
    if (aspectRatio) query.aspectRatio = aspectRatio;
    if (rating && Array.isArray(rating) && rating.length) {
      // Convert string rating values to numbers for database query
      const numericRatings = rating
        .map((r) => parseInt(r, 10))
        .filter((r) => !isNaN(r));
      if (numericRatings.length > 0) {
        query.rating = { $in: numericRatings };
      }
    }

    // Handle date range filtering
    if (dateRange && dateRange.startDate && dateRange.endDate) {
      query.createdAt = {
        $gte: new Date(dateRange.startDate),
        $lte: new Date(dateRange.endDate),
      };
    }

    // Handle duration filtering
    if (duration) {
      // Duration filter mapping: "180" -> 0-270sec, "300" -> 270-390sec, "420" -> 390-510sec, "600" -> 510sec+
      if (duration === "180") {
        query.totalDuration = { $gte: 0, $lte: 270 };
      } else if (duration === "300") {
        query.totalDuration = { $gt: 270, $lte: 390 };
      } else if (duration === "420") {
        query.totalDuration = { $gt: 390, $lte: 510 };
      } else if (duration === "600") {
        query.totalDuration = { $gt: 510 };
      }
    }

    // Handle category filtering (for Highlights page)
    if (category && category !== "all" && category.trim() !== "") {
      query.category = { $regex: category, $options: "i" };
    }

    // Calculate pagination
    const skip = (parseInt(page_no) - 1) * parseInt(limit);

    // Get folders with aggregation for better performance
    const folders = await clipList.aggregate([
      { $match: query },
      { $sort: sortObject },
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "clips",
          localField: "clips",
          foreignField: "_id",
          as: "clips",
        },
      },
      {
        $addFields: {
          totalDuration: {
            $cond: {
              if: { $eq: ["$isPreview", true] },
              then: "$totalDuration",
              else: { $sum: "$clips.duration" },
            },
          },
          clipCount: { $size: "$clips" },
        },
      },
      {
        $project: {
          title: 1,
          clips: 1,
          category: 1,
          streamId: 1,
          userId: 1,
          type: 1,
          aspectRatio: 1,
          rating: 1,
          tags: 1,
          totalDuration: 1,
          clipCount: 1,
          createdAt: 1,
          updatedAt: 1,
          previewUrl: 1,
          thumbnail: 1,
          thumbnails: 1,
          isPreview: 1,
          progressPercent: 1,
          status: 1,
          isAiCreated: 1,
          timeTaken: "$previewData.timeTaken",
          timeTakenHLAI: 1,
          timeTakenHLQ: 1,
          reasonForRating: 1,
          ruleId: 1,
          generatedDuration: "$previewData.duration",
          automationIdentifier: 1,
          completedAt: {
            $toDate: {
              $add: [
                { $multiply: ["$previewData.createdAt._seconds", 1000] },
                { $divide: ["$previewData.createdAt._nanoseconds", 1000000] },
                {
                  $multiply: [{ $ifNull: ["$previewData.timeTaken", 0] }, 1000],
                },
              ],
            },
          },
        },
      },
    ]);

    // Get total count for pagination
    const totalCount = await clipList.countDocuments(query);
    const currentPageNum = parseInt(page_no) || 1;
    const limitNum = parseInt(limit) || 10;
    const totalPagesNum = Math.ceil(totalCount / limitNum);

    // Get counts by type for frontend tabs
    const pagination = {
      currentPage: currentPageNum,
      totalPages: totalPagesNum,
      totalCount: totalCount,
      limit: limitNum,
      hasNextPage: currentPageNum < totalPagesNum,
      hasPrevPage: currentPageNum > 1,
    };

    return res.status(200).json({
      success: true,
      data: folders,
      pagination: pagination,
      message: "Folders retrieved successfully",
    });
  } catch (error) {
    logger.error("[get_folders] Something went wrong", {
      query: req.query,
      error,
    });
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// Get folder by ID
const getFolderById = async (req, res) => {
  try {
    const folderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid folder ID",
      });
    }

    const folder = await clipList.findOne({ _id: folderId, ...activeFilter(req) }).populate("clips");

    if (!folder) {
      return res.status(404).json({
        success: false,
        message: "Folder not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: folder,
      message: "Folder retrieved successfully",
    });
  } catch (error) {
    logger.error("[get_folder_by_id] Something went wrong", {
      folderId: req.params.id,
      error,
    });
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// Get folders by clipId
const getFoldersByClipId = async (req, res) => {
  try {
    const clipId = req.params.clipId || req.query.clipId;
    if (!clipId || !mongoose.Types.ObjectId.isValid(clipId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid clipId is required" });
    }

    const oid = new mongoose.Types.ObjectId(clipId);
    const folders = await clipList.aggregate([
      { $match: { clips: { $in: [oid] } } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "clips",
          localField: "clips",
          foreignField: "_id",
          as: "clips",
        },
      },
      {
        $addFields: {
          totalDuration: {
            $cond: {
              if: { $eq: ["$isPreview", true] },
              then: "$totalDuration",
              else: { $sum: "$clips.duration" },
            },
          },
          clipCount: { $size: "$clips" },
        },
      },
      {
        $project: {
          title: 1,
          aspectRatio: 1,
          createdAt: 1,
          type: 1,
          rating: 1,
          thumbnail: 1,
          thumbnails: 1,
          previewUrl: 1,
          totalDuration: 1,
          clipCount: 1,
        },
      },
    ]);

    return res.status(200).json({ success: true, data: folders });
  } catch (error) {
    logger.error("[getFoldersByClipId] Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get folders by clipId" });
  }
};

// Generate highlight from clips and bumpers
const generateHighlight = async (req, res) => {
  try {
    const {
      folderId,
      clips,
      clipIdArr,
      isHighlightVideo,
      isImage,
      isPreSlate,
      isPostSlate,
      isAudio,
      image,
      overlay,
      aspectRatio,
      audio,
      preSlate,
      postSlate,
      isTransition,
      transitionName,
      selected_transiton,
      audio_intensity_array,
      slate_index,
      type,
      overlayLogo,
      clipsinfo,
      skip_trans,
      userId,
      totalDuration,
      totalDurationWithoutBumper,
    } = req.body;

    // Validate required fields
    if (!folderId || !clips || !Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: folderId, clips array",
      });
    }

    // Find the folder
    const folder = await clipList.findOne({ _id: folderId, ...activeFilter(req) });
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: "Folder not found",
      });
    }

    // Check if highlight generation is already in progress
    // if (folder.isPreview) {
    //   // Check if the generation has been stuck for more than 10 minutes
    //   const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    //   const folderUpdatedAt = new Date(folder.updatedAt);

    //   if (folderUpdatedAt < tenMinutesAgo) {
    //     // Reset stuck generation
    //     logger.info(
    //       `Resetting stuck highlight generation for folder ${folderId}`
    //     );
    //     await clipList.findByIdAndUpdate(folderId, {
    //       $set: {
    //         isPreview: false,
    //         progressPercent: 0,
    //         highlightStatus: "pending",
    //         jobId: null,
    //         error: "Previous generation was reset due to timeout",
    //       },
    //     });
    //   } else {
    //     return res.status(409).json({
    //       success: false,
    //       message:
    //         "Highlight generation is already in progress for this folder",
    //     });
    //   }
    // }

    // Update folder status to indicate processing
    await clipList.findByIdAndUpdate(folderId, {
      $set: {
        isPreview: true,
        previewUrl: "",
        progressPercent: 0,
        highlightInitiatedAt: new Date(),
        status: "processing",
      },
    });

    // Get stream category for sports field
    let sports = "";
    if (folder.streamId) {
      const stream = await Stream.findOne({ streamId: folder.streamId });
      if (stream && stream.category) {
        sports = stream.category;
      }
    }

    // Prepare payload for AI server
    const aiPayload = {
      stream_id: folder.streamId || folderId,
      sports: sports,
      join_clip: {
        join_urls: clips,
      },
      graphics:
        image && image.url
          ? {
              logo_urls: [image.url],
              position: image.position || [],
            }
          : null,
      overlay:
        overlay && overlay.url
          ? {
              type: "video/image",
              urls: overlay && overlay.url ? overlay.url : "",
              overlay_time:
                overlay && overlay.overlay_time ? overlay.overlay_time : 0,
              position: overlay && overlay.position ? overlay.position : [],
            }
          : null,
      trim_manual: null,
      video_urls_single_cms: "",
      webhook_url_single_cms: `${
        process.env.BASE_URL || "http://localhost:3000"
      }/api/folders/highlight-webhook`,
      aspect_ratio: folder.aspectRatio || "16:9",
    };
    logger.info("Sending highlight generation request to AI server", {
      folderId,
      aiPayload,
    });

    // Make request to AI server
    const host2 = await resolveHostByStreamId(folder.streamId);
    const aiResponse = await fetch(`http://${host2}:5003/process_video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aiPayload),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI server responded with status: ${aiResponse.status}`);
    }

    if (![200, 201, 202].includes(aiResponse.status)) {
      throw new Error(`AI server responded with status: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    logger.info("AI server response", aiResult);

    // Store job_id in folder for progress tracking
    await clipList.findByIdAndUpdate(folderId, {
      $set: {
        jobId: aiResult.job_id,
        highlightStatus: aiResult.status,
      },
    });

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "folder",
      entityId: folderId,
      orgId: folder.organization ?? null,
      metadata: {
        source: "generateHighlight",
        job_id: aiResult.job_id,
        process_video: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Highlight generation initiated successfully",
      data: {
        job_id: aiResult.job_id,
        status: aiResult.status,
        stream_id: aiResult.stream_id,
      },
    });
  } catch (error) {
    logger.error("[generateHighlight] Error:", error);

    // Reset folder status on error
    if (req.body.folderId) {
      await clipList.findByIdAndUpdate(req.body.folderId, {
        $set: {
          isPreview: false,
          progressPercent: 0,
        },
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to generate highlight",
      error: error.message,
    });
  }
};

// Webhook handler for AI server response
const highlightWebhook = async (req, res) => {
  try {
    const { job_id, status, result_url, progress, error } = req.body;

    logger.info("Received highlight webhook", req.body);

    // Find folder by job_id
    const folder = await clipList.findOne({ jobId: job_id });
    if (!folder) {
      logger.warn(`Folder not found for job_id: ${job_id}`);
      return res.status(404).json({
        success: false,
        message: "Folder not found for job_id",
      });
    }

    // Update folder based on status
    const updateData = {
      highlightStatus: status,
      progressPercent: progress || 0,
    };

    if (status === "completed" && result_url) {
      updateData.previewUrl = result_url;
      updateData.isPreview = false;
      updateData.progressPercent = 100;
    } else if (status === "failed" || error) {
      updateData.isPreview = false;
      updateData.progressPercent = 0;
      updateData.error = error || "Highlight generation failed";
    }

    await clipList.findByIdAndUpdate(folder._id, { $set: updateData });

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "folder",
      entityId: folder._id?.toString(),
      orgId: folder.organization ?? null,
      metadata: {
        source: "highlightWebhook",
        job_id,
        status,
        progress: progress ?? null,
      },
    });

    logger.info(`Updated folder ${folder._id} with status: ${status}`);

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    logger.error("[highlightWebhook] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process webhook",
      error: error.message,
    });
  }
};

// Get highlight generation progress by folder ID (legacy)
const getHighlightProgress = async (req, res) => {
  try {
    const { folderId } = req.params;

    const folder = await clipList.findOne({ _id: folderId, ...activeFilter(req) });
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: "Folder not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        folderId: folder._id,
        jobId: folder.jobId,
        status: folder.highlightStatus || "pending",
        progress: folder.progressPercent || 0,
        previewUrl: folder.previewUrl || "",
        isPreview: folder.isPreview || false,
        totalDuration: folder.totalDuration || 0,
        error: folder.error || null,
      },
    });
  } catch (error) {
    logger.error("[getHighlightProgress] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get highlight progress",
      error: error.message,
    });
  }
};

// Get highlight generation progress by job_id from AI server
const getHighlightProgressByJobId = async (req, res) => {
  try {
    const { job_id } = req.query;
    logger.info(
      `[getHighlightProgressByJobId] Received request with job_id: ${job_id}`,
    );
    logger.info(`[getHighlightProgressByJobId] Full query params:`, req.query);

    if (!job_id) {
      logger.error(`[getHighlightProgressByJobId] Missing job_id parameter`);
      return res.status(400).json({
        success: false,
        message: "job_id query parameter is required",
      });
    }

    // Make request to AI server progress endpoint
    const host3 = await resolveHostByJobId(
      (req.query && req.query.streamId) || undefined,
    );
    console.log(host3, "host3......");
    const aiResponse = await fetch(
      `http://${host3}:5003/progress?job_id=${job_id}`,
    );

    if (!aiResponse.ok) {
      throw new Error(`AI server responded with status: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    logger.info("AI server progress response", aiResult);

    // Normalize field names expected by frontend
    const { video_url, percent, ...rest } = aiResult || {};
    const sanitized = {
      ...rest,
      percent,
      videoUrl: video_url,
      progress: percent,
    };

    return res.status(200).json({
      success: true,
      data: sanitized,
    });
  } catch (error) {
    logger.error("[getHighlightProgressByJobId] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get highlight progress from AI server",
      error: error.message,
    });
  }
};

// Reset highlight generation status
const resetHighlightStatus = async (req, res) => {
  try {
    const { folderId } = req.params;

    const folder = await clipList.findOne({ _id: folderId, ...activeFilter(req) });
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: "Folder not found",
      });
    }

    // Reset the folder status
    await clipList.findByIdAndUpdate(folderId, {
      $set: {
        isPreview: false,
        progressPercent: 0,
        highlightStatus: "pending",
        jobId: null,
        error: null,
      },
    });

    logger.info(`Reset highlight status for folder ${folderId}`);

    return res.status(200).json({
      success: true,
      message: "Highlight status reset successfully",
    });
  } catch (error) {
    logger.error("[resetHighlightStatus] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset highlight status",
      error: error.message,
    });
  }
};

// Delete a folder by ID
const deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Folder ID is required",
      });
    }

    // Check if folder exists
    const folder = await clipList.findOne({ _id: id, ...activeFilter(req) });
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: "Folder not found",
      });
    }

    // Soft-delete all clips belonging to this folder (highlight)
    if (folder.clips && folder.clips.length > 0) {
      await Clip.updateMany(
        { _id: { $in: folder.clips }, isDeleted: { $ne: true } },
        { $set: getSoftDeleteStamp(req) },
      );
    }

    // Soft-delete the folder
    await clipList.updateOne(
      { _id: id, isDeleted: { $ne: true } },
      { $set: getSoftDeleteStamp(req) },
    );

    // Update stream folder count if streamId exists
    if (folder.streamId) {
      await Stream.findOneAndUpdate(
        { streamId: folder.streamId },
        { $inc: { clipFolderCount: -1 } },
      );
    }

    logger.info("[delete_folder] Folder deleted successfully", {
      folderId: id,
    });

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "delete",
      entity: "folder",
      entityId: folder._id?.toString(),
      orgId: folder.organization || null,
    });
    invalidateMediaLibraryListCache();
    return res.status(200).json({
      success: true,
      message: "Folder soft deleted successfully",
    });
  } catch (error) {
    logger.error("[delete_folder] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export {
  createFolder,
  updateFolder,
  getFolders,
  getFolderById,
  // placeholder to satisfy export order; actual function below
  // new export below
  getFoldersByClipId,
  generateHighlight,
  highlightWebhook,
  getHighlightProgress,
  getHighlightProgressByJobId,
  createAIHighlightProxy,
  getAIHighlightProgressProxy,
  resetHighlightStatus,
  deleteFolder,
};
