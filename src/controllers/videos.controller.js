import { validationResult } from 'express-validator';
import pkg from 'sequelize';
const { Op } = pkg;
// import Video from '../models/Video.js';
import User from '../models/User.js';
import { setCache, getCache, deleteCache } from '../utils/redis.js';
import { processVideo, generateThumbnail } from '../services/video.service.js';
import logger from '../utils/logger.js';
// import { io } from '../app.js';

export const uploadVideo = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { title, description, tags = [], visibility = 'private' } = req.body;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        status: false,
        message: 'No video file uploaded',
      });
    }

    // Check user storage limit
    const user = await User.findByPk(userId);
    const fileSize = req.file.size;
    
    if (user.storage_used + fileSize > user.storage_limit) {
      return res.status(413).json({
        status: false,
        message: 'Storage limit exceeded',
        current: user.storage_used,
        limit: user.storage_limit,
        required: fileSize,
      });
    }

    // Create video record
    const video = await Video.create({
      user_id: userId,
      title,
      description,
      original_filename: req.file.originalname,
      file_url: req.file.location || req.file.path,
      file_size: fileSize,
      format: req.file.mimetype.split('/')[1],
      tags: Array.isArray(tags) ? tags : [],
      visibility,
      status: 'processing',
    });

    // Update user storage
    await user.increment('storage_used', { by: fileSize });

    // Clear user cache
    await deleteCache(`user:${userId}`);

    // Start video processing in background
    processVideo(video.id).catch(error => {
      logger.error(`Video processing failed for ${video.id}:`, error);
    });

    logger.info(`Video uploaded: ${video.id} by user ${userId}`);

    res.status(201).json({
      status: true,
      message: 'Video uploaded successfully',
      video: {
        id: video.id,
        short_id: video.short_id,
        title: video.title,
        status: video.status,
        processing_progress: video.processing_progress,
      },
    });
  } catch (error) {
    logger.error('Video upload error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to upload video',
    });
  }
};

export const getVideos = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      status,
      visibility,
      search,
      sort = 'created_at',
      order = 'DESC',
    } = req.query;

    const offset = (page - 1) * limit;
    const cacheKey = `videos:${userId}:${page}:${limit}:${status}:${visibility}:${search}:${sort}:${order}`;
    
    // Try to get from cache first
    const cachedResult = await getCache(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    // Build where conditions
    const whereConditions = { user_id: userId };
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (visibility) {
      whereConditions.visibility = visibility;
    }
    
    if (search) {
      whereConditions[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Get videos with pagination
    const { count, rows: videos } = await Video.findAndCountAll({
      where: whereConditions,
      order: [[sort, order.toUpperCase()]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email'],
        },
      ],
    });

    const result = {
      status: true,
      data: {
        videos,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(count / limit),
          total_count: count,
          per_page: parseInt(limit),
        },
      },
    };

    // Cache the result for 5 minutes
    await setCache(cacheKey, result, 300);

    res.json(result);
  } catch (error) {
    logger.error('Get videos error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch videos',
    });
  }
};

export const getVideoById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    // Try short_id first, then UUID
    let video = await Video.findOne({
      where: { short_id: id },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email'],
        },
      ],
    });

    if (!video) {
      video = await Video.findOne({
        where: { id },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'name', 'email'],
          },
        ],
      });
    }

    if (!video) {
      return res.status(404).json({
        status: false,
        message: 'Video not found',
      });
    }

    // Check permissions
    if (video.visibility === 'private' && video.user_id !== userId) {
      return res.status(403).json({
        status: false,
        message: 'Access denied',
      });
    }

    // Increment view count if not the owner
    if (video.user_id !== userId) {
      await video.incrementViewCount();
    }

    res.json({
      status: true,
      data: video,
    });
  } catch (error) {
    logger.error('Get video by ID error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch video',
    });
  }
};

export const updateVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, description, tags, visibility } = req.body;

    const video = await Video.findOne({
      where: { id, user_id: userId },
    });

    if (!video) {
      return res.status(404).json({
        status: false,
        message: 'Video not found or access denied',
      });
    }

    // Update video
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];
    if (visibility !== undefined) updateData.visibility = visibility;

    await video.update(updateData);

    // Clear related caches
    await deleteCache(`videos:${userId}:*`);

    logger.info(`Video updated: ${video.id} by user ${userId}`);

    res.json({
      status: true,
      message: 'Video updated successfully',
      data: video,
    });
  } catch (error) {
    logger.error('Update video error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update video',
    });
  }
};

export const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const video = await Video.findOne({
      where: { id, user_id: userId },
    });

    if (!video) {
      return res.status(404).json({
        status: false,
        message: 'Video not found or access denied',
      });
    }

    // Update storage usage
    const user = await User.findByPk(userId);
    await user.decrement('storage_used', { by: video.file_size });

    // Soft delete by updating status
    await video.update({ status: 'deleted' });

    // TODO: Schedule file deletion from storage
    // await scheduleFileCleanup(video.file_url);

    // Clear related caches
    await deleteCache(`videos:${userId}:*`);
    await deleteCache(`user:${userId}`);

    logger.info(`Video deleted: ${video.id} by user ${userId}`);

    res.json({
      status: true,
      message: 'Video deleted successfully',
    });
  } catch (error) {
    logger.error('Delete video error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to delete video',
    });
  }
};

export const trimVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_time, end_time, title } = req.body;
    const userId = req.user.id;

    const video = await Video.findOne({
      where: { id, user_id: userId },
    });

    if (!video) {
      return res.status(404).json({
        status: false,
        message: 'Video not found or access denied',
      });
    }

    if (video.status !== 'ready') {
      return res.status(400).json({
        status: false,
        message: 'Video is not ready for trimming',
      });
    }

    // Validate trim times
    if (start_time >= end_time) {
      return res.status(400).json({
        status: false,
        message: 'End time must be greater than start time',
      });
    }

    if (end_time > video.duration) {
      return res.status(400).json({
        status: false,
        message: 'End time exceeds video duration',
      });
    }

    // Create new video record for trimmed version
    const trimmedVideo = await Video.create({
      user_id: userId,
      title: title || `${video.title} (Trimmed)`,
      description: video.description,
      original_filename: `trimmed_${video.original_filename}`,
      file_url: '', // Will be set after processing
      file_size: 0, // Will be calculated after processing
      format: video.format,
      tags: [...video.tags, 'trimmed'],
      visibility: video.visibility,
      status: 'processing',
    });

    // Start trimming process in background
    processVideoTrim(video.id, trimmedVideo.id, start_time, end_time).catch(error => {
      logger.error(`Video trimming failed for ${trimmedVideo.id}:`, error);
    });

    logger.info(`Video trim started: ${trimmedVideo.id} from ${video.id}`);

    res.json({
      status: true,
      message: 'Video trimming started',
      data: {
        id: trimmedVideo.id,
        short_id: trimmedVideo.short_id,
        status: trimmedVideo.status,
      },
    });
  } catch (error) {
    logger.error('Trim video error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to start video trimming',
    });
  }
};

export const downloadVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const video = await Video.findOne({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({
        status: false,
        message: 'Video not found',
      });
    }

    // Check permissions
    if (video.visibility === 'private' && video.user_id !== userId) {
      return res.status(403).json({
        status: false,
        message: 'Access denied',
      });
    }

    if (video.status !== 'ready') {
      return res.status(400).json({
        status: false,
        message: 'Video is not ready for download',
      });
    }

    // Increment download count
    await video.incrementDownloadCount();

    // Generate download URL or redirect to file
    res.json({
      status: true,
      data: {
        download_url: video.file_url,
        filename: video.original_filename,
        size: video.file_size,
      },
    });
  } catch (error) {
    logger.error('Download video error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to download video',
    });
  }
};

export const getVideoProcessingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const video = await Video.findOne({
      where: { id, user_id: userId },
      attributes: ['id', 'status', 'processing_progress'],
    });

    if (!video) {
      return res.status(404).json({
        status: false,
        message: 'Video not found or access denied',
      });
    }

    res.json({
      status: true,
      data: {
        id: video.id,
        status: video.status,
        processing_progress: video.processing_progress,
      },
    });
  } catch (error) {
    logger.error('Get processing status error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to get processing status',
    });
  }
};

// Helper function for video trimming (placeholder)
const processVideoTrim = async (sourceVideoId, targetVideoId, startTime, endTime) => {
  // This would implement actual video trimming using FFmpeg
  logger.info(`Processing video trim: ${sourceVideoId} -> ${targetVideoId} (${startTime}-${endTime})`);
  
  // Emit progress updates
  io.to(`video-${targetVideoId}`).emit('processing-update', {
    status: 'processing',
    progress: 50,
  });
  
  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Update video status
  await Video.update(
    { status: 'ready', processing_progress: 100 },
    { where: { id: targetVideoId } }
  );
  
  io.to(`video-${targetVideoId}`).emit('processing-update', {
    status: 'ready',
    progress: 100,
  });
};
