
import { PlatformRules, PublishErrorType } from '../config/platform.rules.js';

/**
 * Validates the aspect ratio of a media item against platform rules.
 * @param {string} platform - The target platform (e.g., 'instagram', 'youtube', 'tiktok').
 * @param {object} media - The media item to validate.
 * @param {object} options - Additional options (e.g., isReel, isStory).
 * @returns {object} - { valid: boolean, message: string }
 */
export const validateAspectRatio = (platform, media, options = {}) => {
  if (!media.aspectRatio) {
    // If aspect ratio is unknown, we can't validate strictly, but we might warn.
    return { valid: true, warning: 'Aspect ratio not provided, skipping validation.' };
  }

  const ratio = media.aspectRatio;
  let allowedRatios = [];
  let strict = false; // Some platforms reject, others crop/pad.

  switch (platform) {
    case 'instagram':
      if (options.isReel || options.isStory) {
        allowedRatios = PlatformRules.INSTAGRAM.REEL.ASPECT_RATIOS; // [9/16]
        strict = true;
      } else {
        allowedRatios = PlatformRules.INSTAGRAM.FEED.ASPECT_RATIOS; // [1, 0.8, 1.91]
      }
      break;

    case 'youtube':
      if (options.isShort) {
        // Shorts recommended 9:16, but not strictly enforced by API usually (it just crops).
        // But user asked for validation.
        allowedRatios = [9 / 16]; 
        strict = false; // Warning only
      }
      break;

    case 'facebook':
      if (options.isStory) {
        allowedRatios = PlatformRules.FACEBOOK.STORY.ASPECT_RATIOS; // [9/16]
        strict = true;
      }
      break;
      
    case 'tiktok':
        // TikTok prefers 9:16
        allowedRatios = [9/16];
        strict = false; // TikTok handles other ratios but results may vary
        break;

    default:
      return { valid: true };
  }

  if (allowedRatios.length > 0) {
    // Check if ratio matches any allowed ratio with some tolerance
    const tolerance = 0.05;
    const matches = allowedRatios.some(allowed => Math.abs(allowed - ratio) < tolerance);

    if (!matches) {
      const message = `Invalid aspect ratio ${ratio.toFixed(2)} for ${platform} ${options.isReel ? 'Reel' : options.isStory ? 'Story' : 'Post'}. Expected: ${allowedRatios.map(r => r.toFixed(2)).join(', ')}`;
      if (strict) {
        return { valid: false, message };
      } else {
        return { valid: true, warning: message };
      }
    }
  }

  return { valid: true };
};

/**
 * Validates media file type and size.
 * @param {string} platform 
 * @param {object} media 
 * @returns {object} { valid: boolean, message: string }
 */
export const validateMediaSpecs = (platform, media) => {
    // Placeholder for size validation if we had file size in metadata
    // The user provided MediaInput with sizeInBytes
    
    // Validate Type
    // ... logic using PlatformRules
    
    return { valid: true };
};
