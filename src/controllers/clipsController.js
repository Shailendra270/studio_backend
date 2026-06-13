import Clip from '../models/Clip.js';
import logger from '../utils/logger.js';
import { getUTCDateRange } from '../utils/dateUtils.js';
import { activeFilter } from '../utils/softDelete.js';
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

// Get clips with comprehensive filtering, sorting, time range and pagination
export const getClips = async (req, res) => {
  try {
    const {
      streamId,
      organizationId,
      page = 1,
      limit = 20,
      search,
      sortBy = 'latest',
      aspectRatio,
      tags,
      rating,
      startDate,
      endDate,
      status,
      startTime,
      endTime
    } = req.query;

    // Validate required parameters
    if (!streamId) {
      return res.status(400).json({
        success: false,
        error: 'streamId is required'
      });
    }

    // Build query object
    const query = { streamId, ...activeFilter(req) };
    if (organizationId) query.organization = organizationId;

    // Add search filter
    if (search) {
      const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      query.$or = [
        { title: { $regex: searchRegex } },
        { tags: { $in: [searchRegex] } }
      ];
    }

    // Add aspect ratio filter
    if (aspectRatio) {
      const arCondition = [
        {
          editedVideos: {
            $elemMatch: {
              aspect_ratio: aspectRatio,
              videoUrl: { $exists: true, $ne: "" }
            }
          }
        },
        { aspectRatio: aspectRatio }
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: arCondition }];
        delete query.$or;
      } else {
        query.$or = arCondition;
      }
    }

    // Add tags filter
    if (tags) {
      let tagsArray;
      try {
        // Try to parse as JSON first (new format)
        tagsArray = JSON.parse(tags);
      } catch (e) {
        // Fallback to old format
        tagsArray = Array.isArray(tags) ? tags : [tags];
      }
      if (tagsArray.length > 0) {
        const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regexArr = tagsArray.map((t) => new RegExp(`^${escapeRegex(t)}$`, "i"));
        query.tags = { $in: regexArr };
      }
    }
    
    // Add rating filter
    if (rating) {
      let ratingArray;
      try {
        // Try to parse as JSON first (new format)
        ratingArray = JSON.parse(rating);
      } catch (e) {
        // Fallback to old format
        ratingArray = Array.isArray(rating) ? rating : [rating];
      }
      const ratingNumbers = ratingArray.map(r => parseInt(r)).filter(r => !isNaN(r));
      if (ratingNumbers.length > 0) {
        query.rating = { $in: ratingNumbers };
      }
    }

    // Add date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Add status filter
    if (status && status !== 'all') {
      switch (status) {
        case 'processing':
          query.clipStatus = 'PROCESSING';
          break;
        case 'completed':
          query.clipStatus = 'COMPLETED';
          break;
        case 'failed':
          query.clipStatus = 'FAILED';
          break;
        case 'cancelled':
          query.clipStatus = 'CANCELLED';
          break;
      }
    }

    // Build sort object
    let sortObject = {};
    switch (sortBy) {
      case 'latest':
        sortObject = { createdAt: -1 };
        break;
      case 'oldest':
        sortObject = { createdAt: 1 };
        break;
      case 'rating':
      case 'rating_desc':
        sortObject = { rating: -1, createdAt: -1 };
        break;
      case 'duration':
        sortObject = { duration: -1, createdAt: -1 };
        break;
      case 'timeSequence':
        sortObject = { start_time: 1 };
        break;
      default:
        sortObject = { createdAt: -1 };
    }

    // Calculate pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const hasTimeRange =
      startTime !== undefined &&
      endTime !== undefined &&
      String(startTime).trim() !== '' &&
      String(endTime).trim() !== '';

    const shouldUseTimeAggregation = hasTimeRange || sortBy === 'timeSequence';

    let clips = [];
    let total = 0;

    if (shouldUseTimeAggregation) {
      const startSecondsRange = Math.max(0, Math.floor(Number(startTime) || 0));
      const endSecondsRange = Math.max(0, Math.floor(Number(endTime) || 0));

      const timeToSecondsExpr = (fieldPath) => ({
        $let: {
          vars: { parts: { $split: [fieldPath, ':'] } },
          in: {
            $let: {
              vars: {
                len: { $size: '$$parts' }
              },
              in: {
                $add: [
                  {
                    $multiply: [
                      {
                        $convert: {
                          input: {
                            $cond: [
                              { $eq: ['$$len', 3] },
                              { $arrayElemAt: ['$$parts', 0] },
                              '0'
                            ]
                          },
                          to: 'int',
                          onError: 0,
                          onNull: 0
                        }
                      },
                      3600
                    ]
                  },
                  {
                    $multiply: [
                      {
                        $convert: {
                          input: {
                            $cond: [
                              { $eq: ['$$len', 3] },
                              { $arrayElemAt: ['$$parts', 1] },
                              { $arrayElemAt: ['$$parts', 0] }
                            ]
                          },
                          to: 'int',
                          onError: 0,
                          onNull: 0
                        }
                      },
                      60
                    ]
                  },
                  {
                    $convert: {
                      input: {
                        $cond: [
                          { $eq: ['$$len', 3] },
                          { $arrayElemAt: ['$$parts', 2] },
                          { $arrayElemAt: ['$$parts', 1] }
                        ]
                      },
                      to: 'int',
                      onError: 0,
                      onNull: 0
                    }
                  }
                ]
              }
            }
          }
        }
      });

      const pipeline = [
        { $match: query },
        {
          $addFields: {
            startSeconds: timeToSecondsExpr('$start_time'),
            endSeconds: timeToSecondsExpr('$end_time')
          }
        }
      ];

      if (hasTimeRange) {
        const rangeStart = Math.min(startSecondsRange, endSecondsRange);
        const rangeEnd = Math.max(startSecondsRange, endSecondsRange);
        pipeline.push({
          $match: {
            $or: [
              { startSeconds: { $gte: rangeStart, $lte: rangeEnd } },
              { endSeconds: { $gte: rangeStart, $lte: rangeEnd } },
              { startSeconds: { $lte: rangeStart }, endSeconds: { $gte: rangeEnd } }
            ]
          }
        });
      }

      const sortStage =
        sortBy === 'timeSequence'
          ? { startSeconds: 1, _id: 1 }
          : sortObject;

      pipeline.push(
        { $sort: sortStage },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limitNum }],
            total: [{ $count: 'count' }]
          }
        }
      );

      const aggResult = await Clip.aggregate(pipeline).allowDiskUse(true);
      const agg = aggResult?.[0] || {};
      clips = Array.isArray(agg.data) ? agg.data : [];
      total = agg.total?.[0]?.count || 0;
    } else {
      const result = await Promise.all([
        Clip.find(query).sort(sortObject).skip(skip).limit(limitNum).lean(),
        Clip.countDocuments(query)
      ]);
      clips = result[0];
      total = result[1];
    }

    // Calculate pagination info
    const totalPages = Math.ceil(total / limitNum);

    // Transform clips data for frontend compatibility
    const transformedClips = clips.map(clip => ({
      ...clip,
      // Ensure compatibility with frontend expectations
      thumbnailUrl: clip.thumbnailUrl || clip.videoThumbnailUrl || clip.s3_thumb_url,
      videoUrl: clip.videoUrl || clip.s3_video_url,
      // Map status fields for compatibility
      clipStatus: clip.clipStatus || (clip.status === 1 ? 'COMPLETED' : 'PROCESSING')
    }));

    res.json({
      success: true,
      clips: transformedClips,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    });

  } catch (error) {
    logger.error('Error fetching clips:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get clip by ID;

// Get user clips with comprehensive filtering, sorting, and pagination
export const getUserClips = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'latest',
      aspectRatio,
      tags,
      rating,
      startDate,
      endDate,
      status,
      eventId
    } = req.query;
    
    // Validate required parameters
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    // Build query object
    const query = { userId, ...activeFilter(req) };

    // Add search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Add aspect ratio filter
    if (aspectRatio) {
      query.$or = [
        {
          editedVideos: {
            $elemMatch: {
              aspect_ratio: aspectRatio,
              videoUrl: { $exists: true, $ne: "" }
            }
          }
        },
        { aspectRatio: aspectRatio }
      ];
    }

    // Add event filter
    if (eventId) {
      query.eventId = eventId;
    }

    // Add tags filter
    if (tags) {
      let tagsArray;
      try {
        // Try to parse as JSON first (new format)
        tagsArray = JSON.parse(tags);
      } catch (e) {
        // Fallback to old format
        tagsArray = Array.isArray(tags) ? tags : [tags];
      }
      if (tagsArray.length > 0) {
        query.tags = { $in: tagsArray };
      }
    }
    
    // Add rating filter
    if (rating) {
      let ratingArray;
      try {
        // Try to parse as JSON first (new format)
        ratingArray = JSON.parse(rating);
      } catch (e) {
        // Fallback to old format
        ratingArray = Array.isArray(rating) ? rating : [rating];
      }
      const ratingNumbers = ratingArray.map(r => parseInt(r)).filter(r => !isNaN(r));
      if (ratingNumbers.length > 0) {
        query.rating = { $in: ratingNumbers };
      }
    }

    // Add date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Add status filter
    if (status && status !== 'all') {
      switch (status) {
        case 'processing':
          query.clipStatus = 'PROCESSING';
          break;
        case 'completed':
          query.clipStatus = 'COMPLETED';
          break;
        case 'failed':
          query.clipStatus = 'FAILED';
          break;
        case 'cancelled':
          query.clipStatus = 'CANCELLED';
          break;
      }
    }

    // Build sort object
    let sortObject = {};
    switch (sortBy) {
      case 'latest':
        sortObject = { createdAt: -1 };
        break;
      case 'oldest':
        sortObject = { createdAt: 1 };
        break;
      case 'rating':
        sortObject = { clipRating: -1, createdAt: -1 };
        break;
      case 'duration':
        sortObject = { duration: -1, createdAt: -1 };
        break;
      case 'timeSequence':
        sortObject = { start_time: 1 };
        break;
      default:
        sortObject = { createdAt: -1 };
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Execute query with pagination
    const [clips, total] = await Promise.all([
      Clip.find(query)
        .sort(sortObject)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Clip.countDocuments(query)
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(total / limitNum);

    // Transform clips data for frontend compatibility
    const transformedClips = clips.map(clip => ({
      ...clip,
      // Ensure compatibility with frontend expectations
      thumbnailUrl: clip.thumbnailUrl || clip.videoThumbnailUrl || clip.s3_thumb_url,
      videoUrl: clip.videoUrl || clip.s3_video_url,
      // Map status fields for compatibility
      clipStatus: clip.clipStatus || (clip.status === 1 ? 'COMPLETED' : 'PROCESSING')
    }));

    res.json({
      success: true,
      clips: transformedClips,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    });

  } catch (error) {
    logger.error('Error fetching user clips:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Avoid passing non-ObjectId strings to _id (causes CastError for UUIDs)
function isMongoId(str) {
  return typeof str === 'string' && /^[a-fA-F0-9]{24}$/.test(str);
}

export const getClipById = async (req, res) => {
  try {
    const { clipId } = req.params;
    const query = isMongoId(clipId)
      ? { $or: [{ _id: clipId }, { id: clipId }], ...activeFilter(req) }
      : { id: clipId, ...activeFilter(req) };

    const clip = await Clip.findOne(query).lean();

    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    // Transform clip data
    const transformedClip = {
      ...clip,
      thumbnailUrl: clip.thumbnailUrl || clip.videoThumbnailUrl || clip.s3_thumb_url,
      videoUrl: clip.videoUrl || clip.s3_video_url,
      clipStatus: clip.clipStatus || (clip.status === 1 ? 'COMPLETED' : 'PROCESSING')
    };

    res.json({
      success: true,
      data: transformedClip
    });

  } catch (error) {
    logger.error('Error fetching clip by ID:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Update clip
export const updateClip = async (req, res) => {
  try {
    const { clipId } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.streamId;

    const filter = isMongoId(clipId)
      ? { $or: [{ _id: clipId }, { id: clipId }], ...activeFilter(req) }
      : { id: clipId, ...activeFilter(req) };

    const stampedUpdate = { ...updateData, ...getAuditStamp(req) };

    const clip = await Clip.findOneAndUpdate(
      filter,
      { $set: stampedUpdate },
      { new: true, runValidators: true }
    ).lean();

    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    // Transform clip data
    const transformedClip = {
      ...clip,
      thumbnailUrl: clip.thumbnailUrl || clip.videoThumbnailUrl || clip.s3_thumb_url,
      videoUrl: clip.videoUrl || clip.s3_video_url,
      clipStatus: clip.clipStatus || (clip.status === 1 ? 'COMPLETED' : 'PROCESSING')
    };

    res.json({
      success: true,
      data: transformedClip
    });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "update",
      entity: "clip",
      entityId: transformedClip.id || transformedClip._id?.toString?.(),
      orgId: transformedClip.organization || null,
      metadata: { fields: Object.keys(updateData || {}) },
    });

  } catch (error) {
    logger.error('Error updating clip:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Delete clip (soft delete)
export const deleteClip = async (req, res) => {
  try {
    const { clipId } = req.params;

    const clip = await Clip.findOneAndUpdate(
      {
        $or: [
          { _id: clipId },
      { id: clipId }
        ],
        isDeleted: { $ne: true }
      },
      { $set: getSoftDeleteStamp(req) },
      { new: true }
    );

    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    res.json({
      success: true,
      message: 'Clip deleted successfully'
    });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "delete",
      entity: "clip",
      entityId: clip.id || clip._id?.toString?.(),
      orgId: clip.organization || null,
    });

  } catch (error) {
    logger.error('Error deleting clip:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get clips statistics
export const getClipsStats = async (req, res) => {
  try {
    const { streamId } = req.query;

    if (!streamId) {
      return res.status(400).json({
        success: false,
        error: 'streamId is required'
      });
    }

    const stats = await Clip.aggregate([
      {
        $match: {
          streamId,
          ...activeFilter(req)
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          processing: {
            $sum: {
              $cond: [{ $eq: ['$clipStatus', 'PROCESSING'] }, 1, 0]
            }
          },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$clipStatus', 'COMPLETED'] }, 1, 0]
            }
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ['$clipStatus', 'FAILED'] }, 1, 0]
            }
          },
          totalDuration: { $sum: '$duration' },
          avgRating: { $avg: '$clipRating' }
        }
      }
    ]);

    const result = stats[0] || {
      total: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      totalDuration: 0,
      avgRating: 0
    };

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error fetching clips statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get filter counts for clips (tags, rating, aspect ratios)
export const getClipFilterCounts = async (req, res) => {
  try {
    const {
      streamId,
      search,
      aspectRatio,
      tags,
      rating,
      startDate,
      endDate,
      status,
      players // optional: treated as tags
    } = req.query;

    if (!streamId) {
      return res.status(400).json({
        success: false,
        error: 'streamId is required'
      });
    }

    // Build dynamic match respecting current filters
    const match = {
      streamId,
      ...activeFilter(req),
    };

    // Search filter
    if (search) {
      match.$or = [
        { title: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    // Aspect ratio filter
    if (aspectRatio) {
      match.$or = [
        {
          editedVideos: {
            $elemMatch: {
              aspect_ratio: aspectRatio,
              videoUrl: { $exists: true, $ne: '' },
            },
          },
        },
        { aspectRatio },
      ];
    }

    // Tags and players filters (treated uniformly)
    const tagInputs = [];
    if (tags) {
      try {
        const tagsArray = JSON.parse(tags);
        if (Array.isArray(tagsArray)) tagInputs.push(...tagsArray);
      } catch (e) {
        if (Array.isArray(tags)) tagInputs.push(...tags); else tagInputs.push(tags);
      }
    }
    if (players) {
      try {
        const playersArray = JSON.parse(players);
        if (Array.isArray(playersArray)) tagInputs.push(...playersArray);
      } catch (e) {
        if (Array.isArray(players)) tagInputs.push(...players); else tagInputs.push(players);
      }
    }
    if (tagInputs.length > 0) {
      match.tags = { $in: tagInputs };
    }

    // Rating filter
    if (rating) {
      let ratingArray;
      try {
        ratingArray = JSON.parse(rating);
      } catch (e) {
        ratingArray = Array.isArray(rating) ? rating : [rating];
      }
      const ratingNumbers = ratingArray
        .map((r) => parseInt(r))
        .filter((r) => !isNaN(r));
      if (ratingNumbers.length > 0) {
        match.rating = { $in: ratingNumbers };
      }
    }

    // Date range filter
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    // Status filter
    if (status && status !== 'all') {
      switch (status) {
        case 'processing':
          match.clipStatus = 'PROCESSING';
          break;
        case 'completed':
          match.clipStatus = 'COMPLETED';
          break;
        case 'failed':
          match.clipStatus = 'FAILED';
          break;
        case 'cancelled':
          match.clipStatus = 'CANCELLED';
          break;
      }
    }

    // Compute counts in one optimized aggregation using facets
    const [result] = await Clip.aggregate([
      { $match: match },
      {
        $facet: {
          // Count tags usage across clips
          tags: [
            { $project: { tags: { $ifNull: ['$tags', []] } } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $project: { tag: '$_id', count: 1 } },
            {
              $lookup: {
                from: 'tags',
                let: { tagName: '$tag' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [
                          { $toLower: '$name' },
                          { $toLower: '$$tagName' }
                        ]
                      }
                    }
                  },
                  { $project: { tagType: 1 } },
                  { $limit: 1 }
                ],
                as: 'meta',
              },
            },
            {
              $addFields: {
                tagType: {
                  $ifNull: [{ $arrayElemAt: ['$meta.tagType', 0] }, 'event'],
                },
              },
            },
            { $project: { _id: 0, tag: 1, tagType: 1, count: 1 } },
            { $sort: { count: -1, tag: 1 } },
          ],
          // Count rating distribution
          ratings: [
            { $project: { rating: { $ifNull: ['$rating', null] } } },
            { $match: { rating: { $ne: null } } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          // Count aspect ratios present (base aspectRatio + editedVideos with valid videoUrl)
          aspectRatios: [
            {
              $project: {
                aspects: {
                  $setUnion: [
                    { $cond: [{ $ne: ['$aspectRatio', null] }, ['$aspectRatio'], []] },
                    {
                      $let: {
                        vars: {
                          editedNorm: {
                            $map: {
                              input: {
                                $filter: {
                                  input: { $ifNull: ['$editedVideos', []] },
                                  as: 'ev',
                                  cond: {
                                    $and: [
                                      {
                                        $let: {
                                          vars: {
                                            url: {
                                              $ifNull: ['$$ev.videoUrl', { $ifNull: ['$$ev.video_url', ''] }],
                                            },
                                          },
                                          in: { $gt: [{ $strLenCP: { $trim: { input: '$$url' } } }, 0] },
                                        },
                                      },
                                      {
                                        $let: {
                                          vars: { ar: { $ifNull: ['$$ev.aspect_ratio', ''] } },
                                          in: { $gt: [{ $strLenCP: { $trim: { input: '$$ar' } } }, 0] },
                                        },
                                      },
                                    ],
                                  },
                                },
                              },
                              as: 'ev',
                              in: {
                                ar: {
                                  $let: {
                                    vars: {
                                      raw: {
                                        $replaceAll: {
                                          input: { $trim: { input: { $ifNull: ['$$ev.aspect_ratio', ''] } } },
                                          find: ' ',
                                          replacement: '',
                                        },
                                      },
                                    },
                                    in: {
                                      $replaceAll: {
                                        input: { $toLower: '$$raw' },
                                        find: 'x',
                                        replacement: ':',
                                      },
                                    },
                                  },
                                },
                                ev: { $toLower: { $ifNull: ['$$ev.event', ''] } },
                              },
                            },
                          },
                        },
                        in: {
                          $let: {
                            vars: {
                              arList: { $map: { input: '$$editedNorm', as: 'x', in: '$$x.ar' } },
                            },
                            in: {
                              $filter: {
                                input: { $setUnion: ['$$arList', []] },
                                as: 'ar',
                                cond: {
                                  $let: {
                                    vars: {
                                      allMatches: {
                                        $filter: {
                                          input: '$$editedNorm',
                                          as: 'm',
                                          cond: { $eq: ['$$m.ar', '$$ar'] },
                                        },
                                      },
                                      primaryMatches: {
                                        $filter: {
                                          input: '$$editedNorm',
                                          as: 'm',
                                          cond: {
                                            $and: [
                                              { $eq: ['$$m.ar', '$$ar'] },
                                              { $in: ['$$m.ev', ['autoflip', 'croppedvideos']] },
                                            ],
                                          },
                                        },
                                      },
                                    },
                                    in: {
                                      $or: [
                                        { $gt: [{ $size: '$$primaryMatches' }, 0] },
                                        {
                                          $and: [
                                            { $eq: [{ $size: '$$allMatches' }, 1] },
                                            { $eq: [{ $arrayElemAt: ['$$allMatches.ev', 0] }, 'dynamiccropped'] },
                                          ],
                                        },
                                      ],
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
            { $unwind: '$aspects' },
            { $match: { aspects: { $ne: '' } } },
            { $group: { _id: '$aspects', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
        },
      },
    ]);

    const format = (arr, key = 'value') =>
      (arr || []).map((doc) => ({ [key]: doc._id, count: doc.count }));

    return res.json({
      success: true,
      data: {
        tags: result?.tags || [],
        ratings: format(result?.ratings, 'rating'),
        aspectRatios: format(result?.aspectRatios, 'aspectRatio'),
      },
    });
  } catch (error) {
    logger.error('Error fetching clip filter counts:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// Get calendar counts for published clips in a month
export const getPublishedCalendar = async (req, res) => {
  try {
    const {
      year,
      month,
      streamId,
      sport, // customData.sportName
      platform,
      type,
      status = 'all',
      userId: userIdQuery,
    } = req.query;

    const y = parseInt(year);
    const m = parseInt(month);
    if (!y || !m || m < 1 || m > 12) {
      return res.status(400).json({ success: false, error: 'year and month are required and valid' });
    }

    const { start, end } = getUTCDateRange(y, m);

    const baseMatch = {
      ...activeFilter(req),
      userId: (userIdQuery || req.user?._id?.toString() || req.user?.id || undefined),
    };
    if (!baseMatch.userId) delete baseMatch.userId;
    if (streamId) baseMatch.streamId = streamId;
    if (sport) {
      const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      baseMatch['customData.sportName'] = new RegExp(`^${escapeRegex(sport)}$`, 'i');
    }
    const publishedMatch = {
      'clipPublished.published': true,
      'clipPublished.publishedAt': { $gte: start, $lte: end },
    };
    if (platform) publishedMatch['clipPublished.platform'] = platform;
    if (type) publishedMatch['clipPublished.type'] = type;
    if (status && status !== 'all') publishedMatch['clipPublished.status'] = status;

    const pipeline = [
      { $match: baseMatch },
      { $project: { clipPublished: 1 } },
      { $unwind: '$clipPublished' },
      { $match: publishedMatch },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: '%Y-%m-%d', date: '$clipPublished.publishedAt' }
            },
            status: '$clipPublished.status',
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.date',
          counts: { $push: { status: '$_id.status', count: '$count' } },
        },
      },
      {
        $project: {
          date: '$_id',
          published: {
            $sum: {
              $map: {
                input: '$counts',
                as: 'c',
                in: { $cond: [{ $eq: ['$$c.status', 'completed'] }, '$$c.count', 0] },
              },
            },
          },
          failed: {
            $sum: {
              $map: {
                input: '$counts',
                as: 'c',
                in: { $cond: [{ $eq: ['$$c.status', 'failed'] }, '$$c.count', 0] },
              },
            },
          },
        },
      },
      { $sort: { date: 1 } },
    ];

    const results = await Clip.aggregate(pipeline);
    return res.json({ success: true, data: results });
  } catch (error) {
    logger.error('Error fetching published calendar:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// Get published clips for a specific date
export const getPublishedClipsByDate = async (req, res) => {
  try {
    const {
      date, // YYYY-MM-DD
      streamId,
      sport,
      platform,
      type,
      status = 'completed', // default only show completed
      userId: userIdQuery,
    } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
    }
    const [y, m, d] = String(date).split('-').map((v) => parseInt(v));
    if (!y || !m || !d) {
      return res.status(400).json({ success: false, error: 'date must be in YYYY-MM-DD format' });
    }
    const { start, end } = getUTCDateRange(y, m, d);
    
    const baseMatch = {
      isDeleted: { $ne: true },
      userId: (userIdQuery || req.user?._id?.toString() || req.user?.id || undefined),
    };
    if (!baseMatch.userId) delete baseMatch.userId;
    if (streamId) baseMatch.streamId = streamId;
    if (sport) {
      const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      baseMatch['customData.sportName'] = new RegExp(`^${escapeRegex(sport)}$`, 'i');
    }

    const publishedMatch = {
      'clipPublished.published': true,
      'clipPublished.publishedAt': { $gte: start, $lte: end },
    };
    if (platform) publishedMatch['clipPublished.platform'] = platform;
    if (type) publishedMatch['clipPublished.type'] = type;
    if (status && status !== 'all') publishedMatch['clipPublished.status'] = status;

    const pipeline = [
      { $match: baseMatch },
      {
        $project: {
          streamId: 1,
          title: 1,
          duration: 1,
          aspectRatio: 1,
          thumbnailUrl: 1,
          videoThumbnailUrl: 1,
          s3_thumb_url: 1,
          clipPublished: 1,
          customData: 1,
          description: 1,
          videoUrl:1,
          type:1,
          rating:1,
        },
      },
      { $unwind: '$clipPublished' },
      { $match: publishedMatch },
      {
        $group: {
          _id: '$_id',
          doc: { $first: '$$ROOT' },
          platforms: { $addToSet: '$clipPublished.platform' },
          publishedAt: { $max: '$clipPublished.publishedAt' },
          statuses: { $addToSet: '$clipPublished.status' },
        },
      },
      {
        $project: {
          _id: 1,
          id: { $ifNull: ['$doc.id', { $toString: '$_id' }] },
          streamId: '$doc.streamId',
          title: '$doc.title',
          duration: '$doc.duration',
          aspectRatio: '$doc.aspectRatio',
          thumbnailUrl: {
            $ifNull: ['$doc.thumbnailUrl', { $ifNull: ['$doc.videoThumbnailUrl', '$doc.s3_thumb_url'] }],
          },
          category: '$doc.customData.sportName',
          description: '$doc.description',
          platforms: 1,
          publishedAt: 1,
          videoUrl: '$doc.videoUrl',
          type: '$doc.type',
          rating: '$doc.rating',
          status: {
            $cond: [
              { $in: ['completed', '$statuses'] },
              'completed',
              { $cond: [{ $in: ['failed', '$statuses'] }, 'failed', 'unknown'] },
            ],
          },
        },
      },
      { $sort: { publishedAt: -1 } },
    ];

    const clips = await Clip.aggregate(pipeline);
    return res.json({ success: true, data: clips });
  } catch (error) {
    logger.error('Error fetching published clips by date:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
