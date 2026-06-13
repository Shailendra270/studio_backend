import axios from 'axios';
import PublishEvent from '../models/PublishEvent.js';

const AYRSHARE_API_URL = 'https://api.ayrshare.com/api';
const AYRSHARE_API_KEY = process.env.AYRSHARE_API_KEY;

// Error Types
export const PublishErrorType = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PLATFORM_REJECTION: 'PLATFORM_REJECTION',
  MEDIA_UNREACHABLE: 'MEDIA_UNREACHABLE',
  RATE_LIMIT: 'RATE_LIMIT',
  AUTH_ERROR: 'AUTH_ERROR',
  UNKNOWN: 'UNKNOWN',
};

class SocialPublishingService {
  constructor() {
    this.axiosInstance = axios.create({
      baseURL: AYRSHARE_API_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      },
    });
  }

  /**
   * Main entry point for publishing
   * @param {Object} request - Unified PublishRequest
   * @param {string} profileKey - Optional profile key for multi-tenant
   * @returns {Promise<Object>} Result
   */
  async publish(request, profileKey = null) {
    try {
      // 1. Validate Payload
      this.validatePayload(request);

      // 2. Map to Ayrshare Payload
      const ayrsharePayload = this.mapToAyrsharePayload(request);
      
      // 3. Set Profile Key if provided
      const headers = {};
      if (profileKey) {
        headers['Profile-Key'] = profileKey;
      }

      // 4. Send to Ayrshare
      const response = await this.axiosInstance.post('/post', ayrsharePayload, { headers });
      
      // 5. Handle Response
      return this.handleAyrshareResponse(response.data, request);

    } catch (error) {
      console.error('Social Publishing Error:', error);
      throw this.classifyError(error);
    }
  }

  /**
   * Validate the request payload against strict platform rules
   * @param {Object} request 
   */
  validatePayload(request) {
    const { platform, media, caption, flags } = request;
    
    if (!platform) throw new Error('Platform is required');
    if (!media || media.length === 0) throw new Error('Media is required');

    // Platform Specific Validation
    switch (platform) {
      case 'youtube':
        this.validateYouTube(request);
        break;
      case 'instagram':
        this.validateInstagram(request);
        break;
      case 'facebook':
        this.validateFacebook(request);
        break;
      case 'x-twitter':
        this.validateTwitter(request);
        break;
      case 'tiktok':
        this.validateTikTok(request);
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  validateYouTube(request) {
    const { media, options, flags } = request;
    if (media.length > 1) throw new Error('YouTube allows only 1 video');
    if (media[0].type !== 'video') throw new Error('YouTube requires video media');
    if (!options?.title) throw new Error('YouTube requires a title');
    if (options.title.length > 100) throw new Error('YouTube title must be <= 100 chars');
    
    if (flags?.isShort) {
       // Shorts specific validation (optional strict checks)
       // e.g. duration <= 60s (Ayrshare might handle this, but good to check)
    }
  }

  validateInstagram(request) {
    const { media, caption, flags } = request;
    if (caption && caption.length > 2200) throw new Error('Instagram caption must be <= 2200 chars');
    
    if (flags?.isReel) {
        if (media.some(m => m.type !== 'video')) throw new Error('Instagram Reels must be video');
    } else if (flags?.isStory) {
        if (media.length > 1) throw new Error('Instagram Stories allow only 1 media item');
    } else {
        // Feed
        if (media.length > 10) throw new Error('Instagram Feed allows max 10 items');
    }
  }

  validateFacebook(request) {
     const { media, flags } = request;
     if (flags?.isStory) {
         if (media.length > 1) throw new Error('Facebook Stories allow only 1 media item');
     }
  }

  validateTwitter(request) {
      const { caption, media } = request;
      if (caption && caption.length > 280) throw new Error('Twitter caption must be <= 280 chars');
      if (media.length > 4) throw new Error('Twitter allows max 4 images');
      const videos = media.filter(m => m.type === 'video');
      if (videos.length > 1) throw new Error('Twitter allows only 1 video');
      if (videos.length === 1 && media.length > 1) throw new Error('Twitter does not support mixing video and images');
  }

  validateTikTok(request) {
      const { caption, media } = request;
      if (caption && caption.length > 2200) throw new Error('TikTok caption must be <= 2200 chars');
      
      const videos = media.filter(m => m.type === 'video');
      const images = media.filter(m => m.type === 'image');
      
      if (videos.length > 0 && images.length > 0) throw new Error('TikTok does not support mixing video and images');
      if (images.length > 35) throw new Error('TikTok allows max 35 images');
  }

  /**
   * Map internal DTO to Ayrshare API Payload
   * @param {Object} request 
   */
  mapToAyrsharePayload(request) {
    const { platform, caption, media, publishAt, flags, options } = request;
    
    const payload = {
      post: caption || '',
      platforms: [platform === 'x-twitter' ? 'twitter' : platform], // Map x-twitter to twitter if needed, or check Ayrshare docs
      mediaUrls: media.map(m => m.url),
    };

    if (publishAt) {
      payload.scheduleDate = publishAt; // Ayrshare uses scheduleDate (ISO)
    }

    // Platform Options
    if (platform === 'youtube') {
      payload.youTubeOptions = {
        title: options?.title,
        visibility: options?.visibility || 'public',
        shorts: flags?.isShort || false,
        thumbNail: options?.thumbnailUrl,
        tags: options?.tags || [],
      };
    }

    if (platform === 'instagram') {
      payload.instagramOptions = {
        isReel: flags?.isReel || false,
        story: flags?.isStory || false,
        // Add user tagging, location if in options
      };
    }

    if (platform === 'facebook') {
      payload.faceBookOptions = {
        story: flags?.isStory || false,
        reels: flags?.isReel || false,
      };
    }

    if (platform === 'tiktok') {
      payload.tikTokOptions = {
        disableComments: options?.disableComments || false,
        draft: flags?.isDraft || false,
        visibility: options?.visibility || 'public',
      };
    }
    
    if (platform === 'x-twitter' || platform === 'twitter') {
        if (options?.replyToPostId) {
            payload.replyToPostId = options.replyToPostId;
        }
    }

    return payload;
  }

  handleAyrshareResponse(data, request) {
    // Check for errors in 200 OK response (Ayrshare sometimes returns error in body)
    if (data.status === 'error') {
       throw new Error(data.message || 'Ayrshare returned error status');
    }

    const result = {
      status: 'success',
      refId: data.refId || data.id, // Ayrshare refId
      postIds: data.postIds || [],
      id: data.id,
    };
    
    // Check for async pending
    const platformStatus = data.postIds?.find(p => p.platform === request.platform || (request.platform === 'x-twitter' && p.platform === 'twitter'));
    if (platformStatus && platformStatus.status === 'pending') {
        result.status = 'pending';
    }

    return result;
  }

  classifyError(error) {
    if (error.response) {
      // Axios error
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401 || status === 403) return { type: PublishErrorType.AUTH_ERROR, message: data.message || 'Authentication failed' };
      if (status === 429) return { type: PublishErrorType.RATE_LIMIT, message: 'Rate limit exceeded' };
      if (status === 400) return { type: PublishErrorType.VALIDATION_ERROR, message: data.message || 'Invalid request' };
      
      return { type: PublishErrorType.PLATFORM_REJECTION, message: data.message || 'Platform rejected post' };
    }
    
    if (error.message && Object.values(PublishErrorType).includes(error.type)) {
        return error; // Already classified
    }

    return { type: PublishErrorType.UNKNOWN, message: error.message };
  }
}

export default new SocialPublishingService();
