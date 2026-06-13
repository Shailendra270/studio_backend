import PublishService from '../services/publishing/publish.service.js';
import WebhookHandler from '../services/publishing/webhook.handler.js';
import AyrshareService from '../services/publishing/ayrshare.service.js';
import SocialProfile from '../models/SocialProfile.js';
import { PublishErrorType } from '../config/platform.rules.js';
import shortid from 'shortid';
import { activeFilter } from '../utils/softDelete.js';
import { getAuditStamp, getSoftDeleteStamp } from '../utils/requestContext.js';
import { buildBaseAuditFromRequest, writeAuditLog } from '../services/auditLogService.js';

export const publishPost = async (req, res) => {
  try {
    console.log(req.body,"Publishpost.....................");
    const result = await PublishService.publish(req.body, req.user?._id, req.body.profileKey);
    res.status(201).json(result);
  } catch (error) {
    console.log(error,"Inside catch....");
  console.log(
  error.response?.data?.posts?.[0]?.errors
);
  let statusCode = 500;
  let errorMessage = "Something went wrong";
  let errorType = "UNKNOWN_ERROR";
  let errorDetails = null;

  if (error.response?.data) {
    const ayrshareData = error.response.data;

    if (ayrshareData.posts?.length > 0) {
      const platformError = ayrshareData.posts[0]?.errors?.[0];

      if (platformError) {
        errorMessage = platformError.message;
        errorDetails = platformError;
        
        // Map Ayrshare codes to your internal types
        switch (platformError.code) {
          case 156:
            statusCode = 400;
            errorType = "SOCIAL_ACCOUNT_NOT_LINKED";
            break;
          default:
            statusCode = 422;
            errorType = "PLATFORM_REJECTION";
        }
      }
    } else if (ayrshareData.message) {
      errorMessage = ayrshareData.message;
    }
  } else if (error.message) {
    errorMessage = error.message;
  }

  return res.status(statusCode).json({
    success: false,
    message: errorMessage,
    type: errorType,
    details: errorDetails
  });
}
};

export const handleWebhook = async (req, res) => {
  try {
    await WebhookHandler.handle(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const getHistory = async (req, res) => {
  try {
    const history = await PublishService.getHistory(req.user?._id);
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const checkPostStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { forceSync } = req.query;
    
    const event = await PublishService.checkStatus(id, req.user?._id, forceSync === 'true');
    res.status(200).json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Social Profile CRUD ---

export const createProfile = async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    // 1. Call Ayrshare API
    const ayrshareResponse = await AyrshareService.createProfile(title);
    
    console.log('Ayrshare Create Profile Response:', JSON.stringify(ayrshareResponse, null, 2));

    // 2. Save to Database
    const newProfile = new SocialProfile({
      userId: req.user._id,
      id: ayrshareResponse.id || ayrshareResponse.profileKey || shortid.generate(),
      title: ayrshareResponse.title,
      status: 'active',
      provider: 'ayrshare',
      profileKey: ayrshareResponse.profileKey,
      refId: ayrshareResponse.refId,
      profileId: ayrshareResponse.profileId || ayrshareResponse.id,
      rawResponse: ayrshareResponse
    });

    await newProfile.save();

    res.status(201).json(newProfile);
  } catch (error) {
    const message = error?.response?.data?.message || 'Something went wrong';
    res.status(500).json({ error: message || "Failed to create profile" });
  }
};

export const getProfiles = async (req, res) => {
  try {
    // Fetch profiles from our DB associated with the user
    // We could also sync with Ayrshare if needed, but for now relying on DB
    const profiles = await SocialProfile.find({ userId: req.user._id, ...activeFilter(req) }).sort({ createdAt: -1 });
    res.status(200).json(profiles);
  } catch (error) {
    console.error("Get Profiles Error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch profiles" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { id } = req.params; // Internal DB ID or Ayrshare ID? Let's assume Internal DB ID for safer lookup
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    // 1. Update in Ayrshare
    await AyrshareService.updateProfile(id, { title });

    // 2. Update in DB
    const profile = await SocialProfile.findOne({ profileKey: id, ...activeFilter(req) });
    if (profile) {
      profile.title = title;
      Object.assign(profile, getAuditStamp(req));
      await profile.save();
      writeAuditLog({
        ...buildBaseAuditFromRequest(req),
        action: 'update',
        entity: 'social_profile',
        entityId: profile.profileKey || profile._id?.toString?.(),
        metadata: { fields: ['title'] },
      });
    }

    res.status(200).json(profile || { title });
  } catch (error) {
  console.error("Update Profile Error:", error.response?.data || error);

  const ayrshareError = error.response?.data;

  if (ayrshareError) {
    return res.status(error.response.status || 400).json({
      error : ayrshareError.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: error.message || "Failed to update profile"
  });
}
};

export const deleteProfile = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Delete in Ayrshare
    try {
      await AyrshareService.deleteProfile(id);
    } catch (ayrError) {
      console.warn("Failed to delete profile in Ayrshare (might not exist):", ayrError.message);
      // Continue to delete from DB even if Ayrshare fails (e.g. already deleted)
    }

    // 2. Delete from DB
    const profile = await SocialProfile.findOneAndUpdate(
      { profileKey: id, ...activeFilter(req) },
      { $set: getSoftDeleteStamp(req) },
      { new: true }
    );
    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: 'delete',
      entity: 'social_profile',
      entityId: profile?.profileKey || id,
    });

    res.status(200).json({ message: "Profile deleted successfully" });
  } catch (error) {
    console.error("Delete Profile Error:", error);
    const ayrshareError = error.response?.data;

  if (ayrshareError) {
    return res.status(error.response.status || 400).json({
      error : ayrshareError.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: error.message || "Failed to delete profile"
  });
}
};

export const generateJWT = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[Controller] generateJWT called with id (profileKey): ${id}`);

    const result = await AyrshareService.generateJWT(id);

    return res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error("Generate JWT Error:", error.response?.data || error);

    if (error.response?.data) {
      const { message, code, status, action } = error.response.data;

      return res.status(error.response.status || 403).json({
        error:  message,
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate JWT"
    });
  }
};
