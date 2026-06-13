import { PlatformRules, PublishErrorType } from '../../config/platform.rules.js';
import { validateAspectRatio } from '../../utils/media-validation.util.js';

/**
 * @typedef {Object} MediaInput
 * @property {string} url - Public URL of the media
 * @property {('image'|'video')} type - Media type
 * @property {number} [durationInSeconds] - Duration (for video)
 * @property {number} [aspectRatio] - Aspect ratio (width/height)
 * @property {number} [sizeInBytes] - File size
 */

/**
 * @typedef {Object} PublishRequest
 * @property {('youtube'|'instagram'|'facebook'|'x-twitter'|'tiktok')} platform
 * @property {string} [caption] - Post caption/description
 * @property {MediaInput[]} media - Array of media items
 * @property {string} [publishAt] - ISO 8601 Date string for scheduling
 * @property {Object} [options] - Platform specific options (e.g. title for YT)
 * @property {Object} [flags] - Type flags (isReel, isStory, isShort)
 */

class ValidationService {
  /**
   * Main validation entry point
   * @param {PublishRequest} request
   * @throws {Error} - Throws VALIDATION_ERROR with details
   */
  validate(request) {
    if (!request.platform) this.throwError('Platform is required');
    if (!request.media || !Array.isArray(request.media) || request.media.length === 0) {
      this.throwError('At least one media item is required');
    }

    // Common validations
    this.validateMediaUrls(request.media);
    if (request.publishAt) this.validateSchedule(request.publishAt);

    // Platform specific
    switch (request.platform) {
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
        this.throwError(`Unsupported platform: ${request.platform}`);
    }
  }

  throwError(message) {
    const error = new Error(message);
    error.type = PublishErrorType.VALIDATION_ERROR;
    throw error;
  }

  validateMediaUrls(media) {
    media.forEach((m, i) => {
      if (!m.url || !m.url.startsWith('http')) {
        this.throwError(`Invalid media URL at index ${i}: ${m.url}`);
      }
      if (!['image', 'video'].includes(m.type)) {
        this.throwError(`Invalid media type at index ${i}: ${m.type}`);
      }
      
      // Extension Validation
      const cleanUrl = m.url.split('?')[0];
      const extension = cleanUrl.split('.').pop().toLowerCase();
      const validImageExts = ['jpg', 'jpeg', 'png', 'webp']; // Common formats
      const validVideoExts = ['mp4', 'mov']; // Common formats

      if (m.type === 'image' && !validImageExts.includes(extension)) {
          this.throwError(`Invalid image extension at index ${i}: .${extension}. Allowed: ${validImageExts.join(', ')}`);
      }
      if (m.type === 'video' && !validVideoExts.includes(extension)) {
          this.throwError(`Invalid video extension at index ${i}: .${extension}. Allowed: ${validVideoExts.join(', ')}`);
      }
    });
  }

  validateSchedule(publishAt) {
    // Strict ISO 8601 UTC regex: YYYY-MM-DDTHH:mm:ss.sssZ
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
    
    if (!iso8601Regex.test(publishAt)) {
      this.throwError('Invalid publishAt date format. Use ISO 8601 UTC (e.g. 2023-10-27T10:00:00Z).');
    }

    const date = new Date(publishAt);
    if (isNaN(date.getTime())) {
      this.throwError('Invalid publishAt date value.');
    }
    
    if (date <= new Date()) {
      this.throwError('Scheduled time must be in the future.');
    }
  }

  validateYouTube(request) {
    const { media, options, flags } = request;
    
    if (media.length > 1) this.throwError('YouTube supports only 1 video per post.');
    if (media[0].type !== 'video') this.throwError('YouTube requires video media.');
    
    if (!options?.title) this.throwError('YouTube requires a title.');
    if (options.title.length > PlatformRules.YOUTUBE.MAX_TITLE_LENGTH) {
      this.throwError(`YouTube title must be <= ${PlatformRules.YOUTUBE.MAX_TITLE_LENGTH} characters.`);
    }

    if (flags?.isShort) {
      if (media[0].durationInSeconds && media[0].durationInSeconds > PlatformRules.YOUTUBE.SHORTS.MAX_DURATION_SECONDS) {
        this.throwError(`YouTube Shorts must be <= ${PlatformRules.YOUTUBE.SHORTS.MAX_DURATION_SECONDS} seconds.`);
      }
      
      const ratioCheck = validateAspectRatio('youtube', media[0], { isShort: true });
      if (!ratioCheck.valid) {
          // Shorts recommendation is strict per user request "Validation: Shorts ... 9:16 aspect ratio recommended"
          // User said "recommended" but grouped under "Validation (Strict)".
          // If strict, throw error. If recommended, log warning?
          // I'll throw error as user emphasized "Strict validation layer".
          if (ratioCheck.message) this.throwError(ratioCheck.message);
      }
    }
  }

  validateInstagram(request) {
    const { media, flags } = request;
    const isReel = flags?.isReel;
    const isStory = flags?.isStory;

    if (isReel) {
      if (media.length > 1) this.throwError('Instagram Reels support only 1 video.');
      if (media[0].type !== 'video') this.throwError('Instagram Reels require video media.');
      if (media[0].durationInSeconds && media[0].durationInSeconds > PlatformRules.INSTAGRAM.REEL.MAX_DURATION_SECONDS) {
        this.throwError(`Instagram Reels must be <= ${PlatformRules.INSTAGRAM.REEL.MAX_DURATION_SECONDS} seconds.`);
      }
      
      const ratioCheck = validateAspectRatio('instagram', media[0], { isReel: true });
      if (!ratioCheck.valid) this.throwError(ratioCheck.message);

    } else if (isStory) {
      if (media.length > 1) this.throwError('Instagram Stories support only 1 media item per request.');
      if (media[0].durationInSeconds && media[0].durationInSeconds > PlatformRules.INSTAGRAM.STORY.MAX_DURATION_SECONDS) {
        this.throwError(`Instagram Stories must be <= ${PlatformRules.INSTAGRAM.STORY.MAX_DURATION_SECONDS} seconds.`);
      }

      const ratioCheck = validateAspectRatio('instagram', media[0], { isStory: true });
      if (!ratioCheck.valid) this.throwError(ratioCheck.message);

    } else {
      // Feed
      if (media.length > PlatformRules.INSTAGRAM.FEED.MAX_MEDIA_COUNT) {
        this.throwError(`Instagram Feed supports max ${PlatformRules.INSTAGRAM.FEED.MAX_MEDIA_COUNT} items.`);
      }
      
      // Aspect ratio check for first item (usually dictates the rest in carousels)
      if (media.length > 0) {
          const ratioCheck = validateAspectRatio('instagram', media[0], { isReel: false, isStory: false });
          if (!ratioCheck.valid) this.throwError(ratioCheck.message);
      }

      // Mixed media checks if needed (Ayrshare supports carousels of images/videos)
      const hasVideo = media.some(m => m.type === 'video');
      const hasImage = media.some(m => m.type === 'image');
      
      // Strict rule: "1 video OR 10 images" as per user request?
      // User said: "Feed: 1 video OR 10 images"
      // Ayrshare allows mixing in carousel, but user wants strict validation.
      if (hasVideo && hasImage) {
        // Check if user really meant strict XOR
        // "Instagram (Feed: 1 video OR 10 images)" -> implies strict separation
        // I will enforce strict separation for now to be safe.
        // Wait, Instagram carousels CAN mix. But user requirement is explicit.
        // "1 video OR 10 images"
        this.throwError('Instagram Feed: Cannot mix video and images (User Requirement).');
      }

      if (hasVideo && media.length > 1) {
         // User said "1 video". If multiple videos, fail?
         // "1 video OR 10 images". Singular "video".
         this.throwError('Instagram Feed: Only 1 video allowed (User Requirement).');
      }
    }
  }

  validateFacebook(request) {
    const { media, flags } = request;
    if (flags?.isStory) {
      if (media.length > 1) this.throwError('Facebook Stories support only 1 media item.');
      
      const ratioCheck = validateAspectRatio('facebook', media[0], { isStory: true });
      if (!ratioCheck.valid) this.throwError(ratioCheck.message);
    }
    // Feed allows text or media.
  }

  validateTwitter(request) {
    const { media, caption } = request;
    if (caption && caption.length > PlatformRules.TWITTER.MAX_CAPTION_LENGTH) {
      this.throwError(`X (Twitter) caption must be <= ${PlatformRules.TWITTER.MAX_CAPTION_LENGTH} characters.`);
    }

    const videos = media.filter(m => m.type === 'video');
    const images = media.filter(m => m.type === 'image');

    if (videos.length > 0 && images.length > 0) {
      this.throwError('X (Twitter): Cannot mix video and images.');
    }

    if (videos.length > 1) {
      this.throwError('X (Twitter): Max 1 video allowed.');
    }

    if (images.length > PlatformRules.TWITTER.MAX_MEDIA_COUNT) {
      this.throwError(`X (Twitter): Max ${PlatformRules.TWITTER.MAX_MEDIA_COUNT} images allowed.`);
    }
  }

  validateTikTok(request) {
    const { media, caption } = request;
    
    if (caption && caption.length > PlatformRules.TIKTOK.MAX_CAPTION_LENGTH) {
      this.throwError(`TikTok caption must be <= ${PlatformRules.TIKTOK.MAX_CAPTION_LENGTH} characters.`);
    }

    const videos = media.filter(m => m.type === 'video');
    const images = media.filter(m => m.type === 'image');

    if (videos.length > 0 && images.length > 0) {
      this.throwError('TikTok: Cannot mix video and images.');
    }

    if (videos.length > 1) {
      this.throwError('TikTok: Max 1 video allowed.');
    }

    if (images.length > PlatformRules.TIKTOK.MAX_MEDIA_COUNT) {
      this.throwError(`TikTok: Max ${PlatformRules.TIKTOK.MAX_MEDIA_COUNT} images allowed.`);
    }

    if (media.length > 0) {
        const ratioCheck = validateAspectRatio('tiktok', media[0]);
        if (!ratioCheck.valid) {
             // TikTok is picky, so let's warn or throw depending on strictness.
             // User requested strict validation layer.
             this.throwError(ratioCheck.message);
        }
    }
  }
}

export default new ValidationService();
