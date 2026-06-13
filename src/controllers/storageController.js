import { Storage } from '@google-cloud/storage';
import path from 'path';
import logger from '../utils/logger.js';

// GCP Storage Configuration
const storage = new Storage({
  keyFilename: path.join(process.cwd(), process.env.GCP_KEY_FILE || 'env_config/gcp-service-account.json'),
  projectId: process.env.GCP_PROJECT_ID || 'zeta-envoy-462108-b8',
});

const BUCKET_NAME = process.env.GCP_BUCKET_NAME || 'gcp-mulistream-dev';
const BUCKET_REGION = 'asia-south1';
const STORAGE_ENDPOINT = 'https://storage.googleapis.com';
const STREAMS_FOLDER = 'Entities_data/';

// Generate presigned URL for file upload
const generatePresignedUrl = async (req, res) => {
  try {
    const { userId, resourceBucket, fileName, contentType } = req.body;

    if (!userId || !fileName || !contentType) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, fileName, contentType'
      });
    }

    const bucket = storage.bucket(BUCKET_NAME);
    const filePath = `${STREAMS_FOLDER}${userId}/${fileName}`;
    const file = bucket.file(filePath);

    // Generate presigned URL for upload (expires in 1 hour)
    const [presignedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
      contentType: contentType,
    });

    // Generate short public URL for database storage (no expiration)
    const s3Url = `${STORAGE_ENDPOINT}/${BUCKET_NAME}/${filePath}`;
    
    // Log the URLs for debugging
    // logger.info(`Presigned URL generated for upload: ${presignedUrl.substring(0, 100)}...`);
    // logger.info(`Short S3 URL generated for storage: ${s3Url}`);
    // logger.info(`URL Length Comparison - Presigned: ${presignedUrl.length} chars, S3: ${s3Url.length} chars`);

    res.status(200).json({
      success: true,
      message: 'Presigned URL generated successfully!',
      presignedUrl,
      s3Url,
    });

  } catch (error) {
    logger.error('Error generating presigned URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate presigned URL',
      error: error.message
    });
  }
};

export {
  generatePresignedUrl
};