import PublishEvent from '../../models/PublishEvent.js';
import ValidationService from './validation.service.js';
import PlatformMapperService from './platform-mapper.service.js';
import SchedulerService from './scheduler.service.js';
import RateLimitService from './rate-limit.service.js';
import AyrshareService from './ayrshare.service.js';
import { PublishErrorType } from '../../config/platform.rules.js';

class PublishService {
  /**
   * Process a publish request
   * @param {import('./validation.service').PublishRequest} request
   * @param {string} [userId] - User ID initiating the request
   * @param {string} [profileKey] - Optional Ayrshare profile key
   * @returns {Promise<Object>} Created event details
   */
  async publish(request, userId, profileKey = null) {
    try {
      // 1. Rate Limit Check
      if (userId) {
        await RateLimitService.checkAndIncrement(userId, request.platform);
      }

      // 2. Validate
      ValidationService.validate(request);

      // 3. Create Event Record
      const isDraft = request.flags?.isDraft;
      
      const event = new PublishEvent({
        platform: request.platform,
        contentId: request.media[0]?.url || 'unknown', // Simplification
        type: request.media[0]?.type || 'mixed',
        publisher: userId,
        profileKey: profileKey, // Store for multi-tenant tracking
        status: isDraft ? 'draft' : 'pending',
        scheduledAt: request.publishAt ? new Date(request.publishAt) : undefined,
        content: {
          caption: request.caption,
          media: request.media,
          options: request.options,
          flags: request.flags,
        },
        ayrshareRefId: null, // Will be set by worker
      });
      
      await event.save();

      if (isDraft) {
        return {
          success: true,
          eventId: event._id,
          status: 'draft',
          message: 'Draft saved successfully',
        };
      }

      // 4. Map Payload
      // We rely on local scheduling via BullMQ, so we do NOT include scheduleDate in Ayrshare payload.
      const ayrsharePayload = PlatformMapperService.map(request, { includeScheduleDate: false });
      // 5. Direct Publish (Bypass Scheduler)
      // await SchedulerService.schedule({
      //   eventId: event._id,
      //   payload: ayrsharePayload,
      //   profileKey,
      // }, request.publishAt);

      console.log(`Processing publish event ${event._id} for platform ${ayrsharePayload.platforms[0]}`);

      let response;
      try {
        const profileKeyToUse = profileKey;
        
        // Pre-upload media if present to avoid external fetch issues (403 robots.txt)
        if (ayrsharePayload.mediaUrls && ayrsharePayload.mediaUrls.length > 0) {
          console.log('Pre-uploading media to Ayrshare...');
          const uploadedMediaUrls = [];
          
          for (const url of ayrsharePayload.mediaUrls) {
            try {
              const ayrshareUrl = await AyrshareService.uploadMedia(url, profileKeyToUse);
              uploadedMediaUrls.push(ayrshareUrl);
            } catch (mediaError) {
              console.warn(`Failed to upload media ${url}, falling back to original URL. Error: ${mediaError.message}`);
              uploadedMediaUrls.push(url); // Fallback to original if upload fails
            }
          }
          
          ayrsharePayload.mediaUrls = uploadedMediaUrls;
        }

        response = await AyrshareService.post(ayrsharePayload, profileKeyToUse);
        
        // Update event with success
        event.status = response.status === 'success' || response.status === 'scheduled' ? 
          (response.status === 'scheduled' ? 'scheduled' : 'completed') : 'failed';
        
        event.ayrshareRefId = response.refId || response.id; // Ayrshare returns refId or id
        event.platformPostId = response.id; // Sometimes different
        event.postUrl = response.postIds?.[0]?.postUrl || response.postUrl;
        event.ayrshareResponse = response;
        event.publishedAt = new Date();

        await event.save();
      } catch (error) {
        console.error(`Direct publish failed for event ${event._id}:`, error);
      
        // Update event with failure
        event.status = 'failed';
        event.errorMessage = error.message;
        event.ayrshareResponse = error.response?.data || error.details; // Store error details
        await event.save();
        
        throw error;
      }

      return {
        success: true,
        eventId: event._id,
        status: event.status,
        scheduledAt: request.publishAt,
        response: response
      };

    } catch (error) {
      console.error('PublishService Error:', error);
      throw error;
    }
  }

  /**
   * Get publishing history for a user/team
   */
  async getHistory(userId) {
    return PublishEvent.find({ publisher: userId }).sort({ createdAt: -1 });
  }

  /**
   * Check status of a specific event
   * @param {string} eventId 
   * @param {string} userId 
   * @param {boolean} [forceSync=false] - Whether to force check against Ayrshare API
   */
  async checkStatus(eventId, userId, forceSync = false) {
      const event = await PublishEvent.findOne({ _id: eventId, publisher: userId });
      if (!event) {
          const error = new Error('Event not found');
          error.type = PublishErrorType.VALIDATION_ERROR;
          throw error;
      }

      if (forceSync && event.ayrshareRefId) {
          try {
              // Get latest status from Ayrshare
              // Note: profileKey might be needed if user used one. 
              // We don't store profileKey on event currently, which is a gap for multi-tenant sync.
              // Assuming default profile or we need to store profileKey on event.
              // TODO: Store profileKey on event for accurate syncing.
              const history = await AyrshareService.getHistory(event.ayrshareRefId);
              if (history) {
                  // Update local status
                  // Map Ayrshare status to our status
                  // ... logic here
              }
          } catch (e) {
              console.warn('Failed to sync with Ayrshare:', e.message);
          }
      }

      return event;
  }
}

export default new PublishService();
