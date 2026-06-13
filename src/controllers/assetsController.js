import Bumper from '../models/Bumper.js';
import Graphic from '../models/Graphic.js';
import logger from '../utils/logger.js';
import path from 'path';
import { getOrgMemberUserIds, getCurrentUserOrgId } from '../utils/organizationHelper.js';
import { activeFilter } from '../utils/softDelete.js';
import { getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

// Create Bumper (video asset)
const createBumper = async (req, res) => {
  try {
    const { title, type = 'video', duration, contentType = 'video/mp4', url } = req.body;
    if ( !title || !url) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, url'
      });
    }

    const organizationId = await getCurrentUserOrgId(req);
    const bumperData = {
      title,
      url,
      type,
      duration: duration || 0,
      contentType,
      format: path.extname(url).slice(1) || 'mp4',
      userId: req.user?.userId, // Use authenticated user ID 
      folderId: req.body.folderId || [],
      aspectRatio: req.body.aspectRatio || req.body.aspect_ratio || ''
    };
    if (organizationId) bumperData.organization = organizationId;

    const bumper = await Bumper.create(bumperData);

    logger.info('Bumper created successfully', { bumperId: bumper._id, title });

    res.status(201).json({
      success: true,
      message: 'Bumper added successfully',
      data: bumper
    });

  } catch (error) {
    logger.error('Error creating bumper:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create bumper',
      error: error.message
    });
  }
};

// Create Overlay (mov asset)
const createOverlay = async (req, res) => {
  try {
    const { title, type = 'mov', duration, contentType = 'video/quicktime', url } = req.body;

    if ( !title || !url) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, url'
      });
    }

    const organizationId = await getCurrentUserOrgId(req);
    const overlayData = {
      title,
      url,
      type,
      duration: duration || 0,
      // delay: Number(req.body.delay || 0),
      contentType,
      format: path.extname(url).slice(1) || 'mov',
      userId: req.user?.userId,
      folderId: req.body.folderId || [],
      aspectRatio: req.body.aspectRatio || req.body.aspect_ratio || ''
    };
    if (organizationId) overlayData.organization = organizationId;

    const overlay = await Bumper.create(overlayData); // Using same model as bumpers

    logger.info('Overlay created successfully', { overlayId: overlay._id, title });

    res.status(201).json({
      success: true,
      message: 'Overlay added successfully',
      data: overlay
    });

  } catch (error) {
    logger.error('Error creating overlay:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create overlay',
      error: error.message
    });
  }
};

// Create Graphic (image asset)
const createGraphic = async (req, res) => {
  try {
    const { url, title, format = 'png', contentType = 'image/png' } = req.body;
    const userId = req.user?.userId || req.body.userId;

    if (!url || !title) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: url, title'
      });
    }

    const organizationId = await getCurrentUserOrgId(req);
    const graphicData = {
      url,
      title,
      format,
      contentType,
      userId,
      folderId: req.body.folderId || []
    };
    if (organizationId) graphicData.organization = organizationId;

    const graphic = await Graphic.create(graphicData);

    logger.info('Graphic created successfully', { graphicId: graphic._id, title });

    res.status(201).json({
      success: true,
      message: 'Graphic added successfully',
      data: graphic
    });

  } catch (error) {
    logger.error('Error creating graphic:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create graphic',
      error: error.message
    });
  }
};

// Get Bumpers and Overlays
const getBumpersAndOverlays = async (req, res) => {
  try {
    const { folderId, limit = 15, pageNo = 1, sortBy = -1, userId, type, selectedRatios } = req.body;

    const query = {
      type: { $in: type ? [type] : ['video', 'mov'] },
      ...activeFilter(req),
    };

    const orgUserIds = await getOrgMemberUserIds(req);
    if (orgUserIds && orgUserIds.length > 0) {
      query.userId = { $in: orgUserIds };
    } else if (userId) {
      query.userId = userId;
    } else if (req.user?.userId) {
      query.userId = req.user.userId;
    }
    if (folderId) query.folderId = { $in: [folderId] };
    if (Array.isArray(selectedRatios) && selectedRatios.length > 0) {
      query.aspectRatio = { $in: selectedRatios };
    }

    const skip = (pageNo - 1) * limit;
    const sortOrder = sortBy === -1 ? { _id: -1 } : { _id: 1 };

    const [totalLength, data] = await Promise.all([
      Bumper.countDocuments(query),
      Bumper.find(query)
        .sort(sortOrder)
        .skip(skip)
        .limit(parseInt(limit))
        .lean()
    ]);

    res.status(200).json({
      success: true,
      message: 'Assets retrieved successfully',
      data,
      totalLength,
      currentPage: pageNo,
      totalPages: Math.ceil(totalLength / limit)
    });

  } catch (error) {
    logger.error('Error retrieving bumpers/overlays:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve assets',
      error: error.message
    });
  }
};

// Get Graphics
const getGraphics = async (req, res) => {
  try {
    const { folderId, limit = 15, pageNo = 1, sortBy = -1, userId } = req.body;

    const query = { ...activeFilter(req) };
    const orgUserIds = await getOrgMemberUserIds(req);
    if (orgUserIds && orgUserIds.length > 0) {
      query.userId = { $in: orgUserIds };
    } else if (userId) {
      query.userId = userId;
    } else if (req.user?.userId) {
      query.userId = req.user.userId;
    }
    if (folderId) query.folderId = { $in: [folderId] };

    const skip = (pageNo - 1) * limit;
    const sortOrder = sortBy === -1 ? { _id: -1 } : { _id: 1 };

    const [totalLength, data] = await Promise.all([
      Graphic.countDocuments(query),
      Graphic.find(query)
        .sort(sortOrder)
        .skip(skip)
        .limit(parseInt(limit))
        .lean()
    ]);

    res.status(200).json({
      success: true,
      message: 'Graphics retrieved successfully',
      data,
      totalLength,
      currentPage: pageNo,
      totalPages: Math.ceil(totalLength / limit)
    });

  } catch (error) {
    logger.error('Error retrieving graphics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve graphics',
      error: error.message
    });
  }
};

// Delete Bumper or Overlay by ID
const deleteBumperOrOverlay = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Asset ID is required'
      });
    }

    const asset = await Bumper.findOne({ _id: id, ...activeFilter(req) }).lean();
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found or unauthorized'
      });
    }
    const orgUserIds = await getOrgMemberUserIds(req);
    const allowedUserIds = orgUserIds && orgUserIds.length > 0 ? orgUserIds : [req.user?.userId].filter(Boolean);
    if (allowedUserIds.length > 0 && !allowedUserIds.includes(asset.userId)) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found or unauthorized'
      });
    }
    await Bumper.updateOne({ _id: id, ...activeFilter(req) }, { $set: getSoftDeleteStamp(req) });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'delete',
      entity: 'asset',
      entityId: asset?._id?.toString?.(),
      orgId: asset?.organization || null,
    });

    logger.info('Asset deleted successfully', { assetId: id, type: asset.type });

    res.status(200).json({
      success: true,
      message: `${asset.type === 'video' ? 'Bumper' : 'Overlay'} deleted successfully`,
      data: { id: asset._id }
    });

  } catch (error) {
    logger.error('Error deleting asset:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete asset',
      error: error.message
    });
  }
};

// Delete Graphic by ID
const deleteGraphic = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Graphic ID is required'
      });
    }

    const graphic = await Graphic.findOne({ _id: id, ...activeFilter(req) }).lean();
    if (!graphic) {
      return res.status(404).json({
        success: false,
        message: 'Graphic not found or unauthorized'
      });
    }
    const orgUserIds = await getOrgMemberUserIds(req);
    const allowedUserIds = orgUserIds && orgUserIds.length > 0 ? orgUserIds : [req.user?.userId].filter(Boolean);
    if (allowedUserIds.length > 0 && !allowedUserIds.includes(graphic.userId)) {
      return res.status(404).json({
        success: false,
        message: 'Graphic not found or unauthorized'
      });
    }
    await Graphic.updateOne({ _id: id, ...activeFilter(req) }, { $set: getSoftDeleteStamp(req) });
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'delete',
      entity: 'graphic_asset',
      entityId: graphic?._id?.toString?.(),
      orgId: graphic?.organization || null,
    });

    logger.info('Graphic deleted successfully', { graphicId: id });

    res.status(200).json({
      success: true,
      message: 'Graphic deleted successfully',
      data: { id: graphic._id }
    });

  } catch (error) {
    logger.error('Error deleting graphic:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete graphic',
      error: error.message
    });
  }
};

export {
  createBumper,
  createOverlay,
  createGraphic,
  getBumpersAndOverlays,
  getGraphics,
  deleteBumperOrOverlay,
  deleteGraphic
};
