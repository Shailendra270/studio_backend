export interface MediaInput {
  url: string;
  type: 'image' | 'video';
  aspectRatio?: number;
  sizeInBytes?: number;
  durationInSeconds?: number;
}

export interface PublishRequest {
  platform: 'youtube' | 'instagram' | 'facebook' | 'x-twitter' | 'tiktok';
  caption?: string;
  media: MediaInput[];
  publishAt?: string; // ISO 8601
  visibility?: 'public' | 'private' | 'unlisted' | 'followers' | 'friends';
  flags?: {
    isReel?: boolean;
    isStory?: boolean;
    isShort?: boolean;
    isDraft?: boolean;
  };
  options?: Record<string, any>;
  profileKey?: string;
}

export interface PublishResult {
  success: boolean;
  eventId: string;
  status: 'pending' | 'queued' | 'completed' | 'failed' | 'scheduled';
  scheduledAt?: string;
  ayrshareRefId?: string;
}

export interface WebhookPayload {
  refId: string;
  id: string;
  status: 'success' | 'error' | 'published' | 'failed';
  postIds?: Array<{ id: string; postUrl: string; platform: string }>;
  errors?: Array<{ message: string }>;
}
