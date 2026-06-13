import express from "express";
import axios from "axios";
import path from "path";
import { Storage } from "@google-cloud/storage";
import Clip from "../models/Clip.js";
import PublishEvent from "../models/PublishEvent.js";

const router = express.Router();

const storage = new Storage({
  keyFilename: path.join(process.cwd(), process.env.GCP_KEY_FILE || 'env_config/gcp-service-account.json'),
  projectId: process.env.GCP_PROJECT_ID || 'zeta-envoy-462108-b8',
});
const BUCKET_NAME = process.env.GCP_BUCKET_NAME || 'gcp-mulistream-dev';
const STORAGE_ENDPOINT = 'https://storage.googleapis.com';

function sanitizeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_').trim();
}

async function putToBucket(filePath, contentType, sourceUrlOrBody) {
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(filePath);
  const [presignedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 60 * 60 * 1000,
    contentType,
  });
  let data;
  let headers = { 'Content-Type': contentType };
  if (typeof sourceUrlOrBody === 'string') {
    const resp = await axios.get(sourceUrlOrBody, { responseType: 'arraybuffer' });
    data = resp.data;
  } else {
    data = sourceUrlOrBody;
  }
  await axios.put(presignedUrl, data, { headers });
  const s3Url = `${STORAGE_ENDPOINT}/${BUCKET_NAME}/${filePath}`;
  return { s3Url, filePath };
}

router.post('/publish', async (req, res) => {
  try {
    const { clipId, title, folderPath = '', include = [], userId } = req.body || {};
    if (!clipId || !title) return res.status(400).json({ status: false, message: 'clipId and title are required' });
    const clip = await Clip.findOne({ $or: [{ id: clipId }, { _id: clipId }] });
    if (!clip) return res.status(404).json({ status: false, message: 'Clip not found' });

    const destFolder = String(folderPath || '').replace(/^\/+/, '').replace(/\/+$/,'') + '/';
    const safeTitle = sanitizeName(title);

    const results = [];
    // Always dump clip
    const clipPath = `${destFolder}${safeTitle}.mp4`;
    const clipOut = await putToBucket(clipPath, 'video/mp4', clip.videoUrl);
    results.push({ type: 'clip', url: clipOut.s3Url });

    // Clip JSON
    if (include.includes('clip_json')) {
      const data = {
        id: clip.id || (clip._id?.toString()),
        streamId: clip.streamId,
        title: clip.title,
        start_time: clip.start_time,
        end_time: clip.end_time,
        duration: clip.duration,
        aspect_ratio: clip.aspectRatio,
        rating: clip.rating,
        tags: Array.isArray(clip.tags) ? clip.tags : [],
        videoUrl: clip.videoUrl,
        thumbnailUrl: clip.thumbnailUrl,
        thumbnails: Array.isArray(clip.thumbnails) ? clip.thumbnails : [],
        status: clip.clipStatus,
        progress: clip.progress,
        description: clip.description || '',
        userId: clip.userId || '',
        customData: clip.customData || {},
        editedVideos: Array.isArray(clip.editedVideos) ? clip.editedVideos : [],
        createdAt: clip.createdAt,
        updatedAt: clip.updatedAt,
      };
      const jsonPath = `${destFolder}${safeTitle}_clip.json`;
      const jsonOut = await putToBucket(jsonPath, 'application/json', Buffer.from(JSON.stringify(data, null, 2)));
      results.push({ type: 'clip_json', url: jsonOut.s3Url });
    }

    // Thumbnail
    if (include.includes('thumbnail_jpeg') && clip.thumbnailUrl) {
      const thumbPath = `${destFolder}${safeTitle}.jpg`;
      const thumbOut = await putToBucket(thumbPath, 'image/jpeg', clip.thumbnailUrl);
      results.push({ type: 'thumbnail', url: thumbOut.s3Url });
    }

    // Update clipPublished
    await Clip.updateOne(
      { _id: clip._id },
      { $push: { clipPublished: { type: 'cloud', platform: 'gcp', published: true, status: 'completed', publishedAt: new Date() } }, $set: { isS3Published: true } }
    );

    // PublishEvent
    await PublishEvent.create({
      id: `${clip.id}-cloud-${Date.now()}`,
      contentType: 'clip',
      contentId: clipId || (clip._id?.toString()),
      entityId: '',
      platform: 'gcp',
      type: 'cloud',
      publisher: 'UI',
      publisherId: userId || clip.userId || '',
      status: 'completed',
      initiatedAt: new Date(),
      publishedAt: new Date(),
      content: {
        _id: clip._id?.toString(),
        episodeTitle: clip.title,
        duration: clip.duration,
        videoThumbnailUrl: clip.thumbnailUrl,
        clipRating: clip.rating,
        streamId: clip.streamId,
        entityId: '',
      },
      aspectRatio: clip.aspectRatio,
      streamId: clip.streamId,
      details: { id: `${clip.id}-cloud`, folderPath: destFolder, files: results },
      publishFiles: [],
    });

    return res.json({ status: true, data: { files: results } });
  } catch (err) {
    return res.status(500).json({ status: false, message: 'Cloud publish failed', error: String(err?.message || err) });
  }
});

export default router;

