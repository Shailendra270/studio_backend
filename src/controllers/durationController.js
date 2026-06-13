import axios from 'axios';
import logger from '../utils/logger.js';

// Get video duration from URL
const getDuration = async (req, res) => {
  try {
    let { url, publicUrl, userId, fileName } = req.body;
    
    // Priority: publicUrl > url > generate from userId/fileName
    let videoUrl = publicUrl || url;
    
    if (!videoUrl && userId && fileName) {
      // Generate public URL from userId and fileName
      const BUCKET_NAME = process.env.GCP_BUCKET_NAME || 'gcp-mulistream-dev';
      const STORAGE_ENDPOINT = 'https://storage.googleapis.com';
      const STREAMS_FOLDER = 'Entities_data/';
      const filePath = `${STREAMS_FOLDER}${userId}/${fileName}`;
      videoUrl = `${STORAGE_ENDPOINT}/${BUCKET_NAME}/${filePath}`;
      logger.info('Generated public URL for AI service', { videoUrl, userId, fileName });
    }
    
    if (!videoUrl) {
      // Handle case where URL might be in stringified JSON
      try {
        const urlData = JSON.parse(req.body);
        videoUrl = urlData?.url || urlData?.publicUrl || '';
      } catch (parseError) {
        return res.status(400).json({
          status: false,
          duration: 0,
          message: 'URL, publicUrl, or userId/fileName is required'
        });
      }
    }

    if (!videoUrl) {
      return res.status(400).json({
        status: false,
        duration: 0,
        message: 'URL, publicUrl, or userId/fileName is required'
      });
    }

    // Use AI service to get video metadata
    const AI_NEW_ALB_URI = process.env.AI_NEW_ALB_URI || process.env.AISERVER;
    if (!AI_NEW_ALB_URI) {
      // Fallback: Basic duration estimation (in production, use proper video analysis)
      logger.warn('AI service not configured, using fallback duration estimation');
      return res.status(200).json({
        status: true,
        duration: 30, // Default 30 seconds
        message: 'Duration estimated (AI service not available)'
      });
    }

    try {
      const response = await axios.post(
        `${AI_NEW_ALB_URI}/get_meta_info`,
        {
          url: videoUrl
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      let duration = 0;
      let aspectRatio = null;
      // Extract duration from the new API response format
      if (response.data?.metadata?.format?.duration) {
        duration = parseFloat(response.data.metadata.format.duration || 0);
      }
      if (response.data?.aspect_ratio) {
        aspectRatio = String(response.data.aspect_ratio);
      }

      logger.info('Duration extracted successfully', { videoUrl, duration, aspectRatio });

      res.status(200).json({
        status: true,
        duration,
        aspect_ratio: aspectRatio,
        message: 'Duration extracted successfully'
      });

    } catch (aiError) {
      console.log('AI service error details:', {
        message: aiError.message,
        response: aiError.response?.data,
        status: aiError.response?.status,
        url: videoUrl
      });
      logger.warn('AI service failed, using fallback', { error: aiError.message, videoUrl });
      
      // Fallback duration estimation
      res.status(200).json({
        status: true,
        duration: 0, // Default 30 seconds
        aspect_ratio: null,
        message: 'Duration estimated (AI service failed)'
      });
    }

  } catch (error) {
    logger.error('Error in duration extraction:', error);
    res.status(500).json({
      status: false,
      duration: 0,
      aspect_ratio: null,
      message: 'Duration extraction failed'
    });
  }
};

export {
  getDuration
};
