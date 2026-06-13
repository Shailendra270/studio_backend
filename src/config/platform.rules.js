/**
 * @fileoverview Platform-specific validation rules and constraints
 */

export const PlatformRules = {
  YOUTUBE: {
    MAX_TITLE_LENGTH: 100,
    MAX_DESCRIPTION_LENGTH: 5000,
    SUPPORTED_MEDIA_TYPES: ['video'],
    MAX_MEDIA_COUNT: 1,
    SHORTS: {
      MAX_DURATION_SECONDS: 180, // Ayrshare/YouTube limits
      RECOMMENDED_ASPECT_RATIO: 9 / 16,
    },
    VIDEO: {
      MAX_SIZE_MB: 128000, // 128GB
    },
  },
  INSTAGRAM: {
    FEED: {
      MAX_MEDIA_COUNT: 10, // Carousel
      SUPPORTED_MEDIA_TYPES: ['image', 'video'],
      ASPECT_RATIOS: [1, 4 / 5, 1.91 / 1], // Square, Portrait, Landscape
    },
    REEL: {
      MAX_DURATION_SECONDS: 90,
      SUPPORTED_MEDIA_TYPES: ['video'],
      ASPECT_RATIOS: [9 / 16],
    },
    STORY: {
      MAX_MEDIA_COUNT: 1,
      MAX_DURATION_SECONDS: 15, // Segments
      SUPPORTED_MEDIA_TYPES: ['image', 'video'],
      ASPECT_RATIOS: [9 / 16],
    },
    DAILY_POST_LIMIT: 50, // Soft limit/recommendation
  },
  FACEBOOK: {
    FEED: {
      SUPPORTED_MEDIA_TYPES: ['image', 'video'],
    },
    STORY: {
      MAX_MEDIA_COUNT: 1,
      SUPPORTED_MEDIA_TYPES: ['image', 'video'],
      ASPECT_RATIOS: [9 / 16],
    },
  },
  TWITTER: { // X
    MAX_CAPTION_LENGTH: 280,
    MAX_MEDIA_COUNT: 4, // 4 images OR 1 video
    SUPPORTED_MEDIA_TYPES: ['image', 'video'],
    VIDEO: {
      MAX_DURATION_SECONDS: 140,
      MAX_SIZE_MB: 512,
    },
  },
  TIKTOK: {
    MAX_CAPTION_LENGTH: 2200,
    MAX_MEDIA_COUNT: 35, // Images
    SUPPORTED_MEDIA_TYPES: ['video', 'image'],
    VIDEO: {
      MAX_DURATION_SECONDS: 600, // 10 mins
    },
    RATE_LIMITS: {
      POSTS_PER_DAY: 15, // User specified
      POSTS_PER_MINUTE: 6,
    },
  },
};

export const PublishErrorType = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PLATFORM_REJECTION: 'PLATFORM_REJECTION',
  MEDIA_UNREACHABLE: 'MEDIA_UNREACHABLE',
  RATE_LIMIT: 'RATE_LIMIT',
  AUTH_ERROR: 'AUTH_ERROR',
  UNKNOWN: 'UNKNOWN',
};
