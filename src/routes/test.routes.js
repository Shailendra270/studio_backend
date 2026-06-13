import express from 'express';
import { Storage } from '@google-cloud/storage';
import logger from '../utils/logger.js';

const router = express.Router();

// Test endpoint to demonstrate URL format (no auth required)
router.get('/url-demo', async (req, res) => {
  try {
    const BUCKET_NAME = process.env.GCP_BUCKET_NAME || 'gcp-mulistream-dev';
    const STORAGE_ENDPOINT = 'https://storage.googleapis.com';
    const STREAMS_FOLDER = 'Entities_data/';
    
    // Sample file path
    const userId = 'demo123';
    const fileName = 'sample-video.mp4';
    const filePath = `${STREAMS_FOLDER}${userId}/${fileName}`;
    
    // Initialize GCP Storage
    const storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GCP_KEY_FILE,
    });
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(filePath);
    
    // Generate presigned URL (long)
    const [presignedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
      contentType: 'video/mp4',
    });
    
    // Generate short public URL
    const s3Url = `${STORAGE_ENDPOINT}/${BUCKET_NAME}/${filePath}`;
    
    logger.info(`Demo URL comparison - Presigned: ${presignedUrl.length} chars, S3: ${s3Url.length} chars`);
    
    res.status(200).json({
      success: true,
      message: 'URL format demonstration',
      comparison: {
        presignedUrl: {
          url: presignedUrl,
          length: presignedUrl.length,
          purpose: 'For uploading files (temporary, signed)'
        },
        s3Url: {
          url: s3Url,
          length: s3Url.length,
          purpose: 'For database storage (permanent, public)'
        },
        lengthReduction: `${Math.round((1 - s3Url.length / presignedUrl.length) * 100)}% shorter`
      }
    });
    
  } catch (error) {
    logger.error('Error in URL demo:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating demo URLs',
      error: error.message
    });
  }
});

export default router;