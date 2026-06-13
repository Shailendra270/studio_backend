/**
 * Service to map unified PublishRequest to Ayrshare API payload
 */
class PlatformMapperService {
  /**
   * Maps a unified request to Ayrshare payload
   * @param {import('./validation.service').PublishRequest} request
   * @param {Object} [mapperOptions] - Options for mapping
   * @param {boolean} [mapperOptions.includeScheduleDate=false] - Whether to include scheduleDate in payload (if false, caller handles scheduling)
   * @returns {Object} Ayrshare payload
   */
  map(request, mapperOptions = { includeScheduleDate: false }) {
    const { platform, caption, media, publishAt, options, flags } = request;

    const payload = {
      post: caption || '',
      platforms: [this.mapPlatformName(platform)],
      mediaUrls: media.map(m => m.url),
    };

    if (publishAt && mapperOptions.includeScheduleDate) {
      payload.scheduleDate = publishAt; // ISO 8601
    }

    // Platform specific options
    switch (platform) {
      case 'youtube':
        payload.youTubeOptions = {
          title: options?.title || 'Untitled Video',
          visibility: options?.visibility || 'public',
          shorts: flags?.isShort || false,
        };
        if (options?.thumbnailUrl && !payload.youTubeOptions.shorts) {
          payload.youTubeOptions.thumbNail = options.thumbnailUrl;
        }
        break;
      case 'instagram':
        if (flags?.isReel) {
          payload.instagramOptions = { reels: true };
          if (options?.thumbnailUrl) {
            payload.instagramOptions.thumbNail = options.thumbnailUrl;
          }
        } else if (flags?.isStory) {
          payload.instagramOptions = { story: true };
        }
        // Carousel is default if multiple images
        break;
      case 'facebook':
        if (flags?.isStory) {
          payload.faceBookOptions = { stories: true };
          break;
        }
        if (Array.isArray(options?.targetCountries) && options.targetCountries.length > 0) {
          if (!payload.faceBookOptions) payload.faceBookOptions = {};
          payload.faceBookOptions.targeting = {
            ...(payload.faceBookOptions.targeting || {}),
            countries: options.targetCountries.slice(0, 25),
          };
        }
        if (options?.thumbnailUrl) {
          if (!payload.faceBookOptions) payload.faceBookOptions = {};
          payload.faceBookOptions.thumbNail = options.thumbnailUrl;
        }
        break;
      case 'tiktok':
        payload.tikTokOptions = {
          // TikTok specific options if any
          privacy: options?.visibility === 'private' ? 'SELF_ONLY' : 'PUBLIC',
        };
        if (options?.thumbnailUrl) {
          payload.tikTokOptions.thumbNail = options.thumbnailUrl;
        }
        break;
      case 'x-twitter':
        payload.twitterOptions = {};
        if (options?.thumbnailUrl) {
          payload.twitterOptions.thumbNail = options.thumbnailUrl;
        }
        break;
    }

    return payload;
  }

  mapPlatformName(platform) {
    const map = {
      'youtube': 'youtube',
      'instagram': 'instagram',
      'facebook': 'facebook',
      'x-twitter': 'twitter', // Ayrshare uses 'twitter'
      'tiktok': 'tiktok',
    };
    return map[platform] || platform;
  }
}

export default new PlatformMapperService();
