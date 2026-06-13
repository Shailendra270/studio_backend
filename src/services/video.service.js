// import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
// import sharp from 'sharp';
// import Video from '../models/Video.js';
import logger from '../utils/logger.js';
// import { io } from '../app.js';

// Set FFmpeg path if specified in environment
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

export const processVideo = async (videoId) => {
  try {
    const video = await Video.findByPk(videoId);
    if (!video) {
      throw new Error('Video not found');
    }

    logger.info(`Starting video processing for: ${videoId}`);

    // Update status to processing
    await video.update({
      status: 'processing',
      processing_progress: 0,
    });

    // Emit processing started event
    io.to(`video-${videoId}`).emit('processing-update', {
      status: 'processing',
      progress: 0,
    });

    // Get video metadata
    const metadata = await getVideoMetadata(video.file_url);
    
    // Update video with metadata
    await video.update({
      duration: metadata.duration,
      resolution: metadata.resolution,
      bitrate: metadata.bitrate,
      fps: metadata.fps,
      codec: metadata.codec,
      processing_progress: 30,
    });

    // Emit metadata extracted event
    io.to(`video-${videoId}`).emit('processing-update', {
      status: 'processing',
      progress: 30,
    });

    // Generate thumbnail
    const thumbnailUrl = await generateThumbnail(video.file_url, videoId);
    
    await video.update({
      thumbnail_url: thumbnailUrl,
      processing_progress: 60,
    });

    // Emit thumbnail generated event
    io.to(`video-${videoId}`).emit('processing-update', {
      status: 'processing',
      progress: 60,
    });

    // Process video for different qualities if needed
    const processedUrls = await processVideoQualities(video.file_url, videoId);
    
    await video.update({
      metadata: {
        ...video.metadata,
        processed_qualities: processedUrls,
      },
      processing_progress: 90,
    });

    // Emit processing almost complete
    io.to(`video-${videoId}`).emit('processing-update', {
      status: 'processing',
      progress: 90,
    });

    // Mark as ready
    await video.update({
      status: 'ready',
      processing_progress: 100,
    });

    // Emit processing complete event
    io.to(`video-${videoId}`).emit('processing-update', {
      status: 'ready',
      progress: 100,
    });

    logger.info(`Video processing completed for: ${videoId}`);
    return video;
  } catch (error) {
    logger.error(`Video processing failed for ${videoId}:`, error);
    
    // Update status to failed
    await Video.update(
      { status: 'failed' },
      { where: { id: videoId } }
    );

    // Emit processing failed event
    io.to(`video-${videoId}`).emit('processing-update', {
      status: 'failed',
      progress: 0,
      error: error.message,
    });

    throw error;
  }
};

export const getVideoMetadata = (videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }

      resolve({
        duration: parseFloat(metadata.format.duration),
        resolution: `${videoStream.width}x${videoStream.height}`,
        bitrate: parseInt(metadata.format.bit_rate),
        fps: eval(videoStream.r_frame_rate),
        codec: videoStream.codec_name,
        size: parseInt(metadata.format.size),
      });
    });
  });
};

export const generateThumbnail = (videoPath, videoId) => {
  return new Promise((resolve, reject) => {
    const outputPath = `uploads/thumbnails/${videoId}.jpg`;
    
    // Ensure thumbnail directory exists
    const thumbnailDir = path.dirname(outputPath);
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['10%'],
        filename: `${videoId}.jpg`,
        folder: 'uploads/thumbnails',
        size: '640x360',
      })
      .on('end', () => {
        // Optimize thumbnail with sharp
        sharp(outputPath)
          .jpeg({ quality: 80 })
          .toFile(`uploads/thumbnails/${videoId}_optimized.jpg`)
          .then(() => {
            // Replace original with optimized version
            fs.renameSync(`uploads/thumbnails/${videoId}_optimized.jpg`, outputPath);
            resolve(`/uploads/thumbnails/${videoId}.jpg`);
          })
          .catch(reject);
      })
      .on('error', reject);
  });
};

export const processVideoQualities = async (videoPath, videoId) => {
  const qualities = process.env.VIDEO_QUALITY_LEVELS?.split(',') || ['720p'];
  const processedUrls = {};

  for (const quality of qualities) {
    try {
      const outputPath = await transcodeVideo(videoPath, videoId, quality);
      processedUrls[quality] = outputPath;
    } catch (error) {
      logger.error(`Failed to process ${quality} for video ${videoId}:`, error);
    }
  }

  return processedUrls;
};

export const transcodeVideo = (inputPath, videoId, quality) => {
  return new Promise((resolve, reject) => {
    const outputDir = `uploads/processed/${videoId}`;
    const outputPath = `${outputDir}/${quality}.mp4`;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Quality settings
    const qualitySettings = {
      '360p': { width: 640, height: 360, bitrate: '800k' },
      '480p': { width: 854, height: 480, bitrate: '1200k' },
      '720p': { width: 1280, height: 720, bitrate: '2500k' },
      '1080p': { width: 1920, height: 1080, bitrate: '5000k' },
    };

    const settings = qualitySettings[quality];
    if (!settings) {
      reject(new Error(`Unknown quality: ${quality}`));
      return;
    }

    ffmpeg(inputPath)
      .outputOptions([
        `-c:v libx264`,
        `-preset medium`,
        `-crf 23`,
        `-c:a aac`,
        `-b:a 128k`,
        `-maxrate ${settings.bitrate}`,
        `-bufsize ${parseInt(settings.bitrate) * 2}k`,
        `-vf scale=${settings.width}:${settings.height}`,
      ])
      .output(outputPath)
      .on('progress', (progress) => {
        logger.debug(`Transcoding ${quality} progress: ${progress.percent}%`);
      })
      .on('end', () => {
        resolve(`/uploads/processed/${videoId}/${quality}.mp4`);
      })
      .on('error', reject)
      .run();
  });
};

export const trimVideo = (inputPath, outputPath, startTime, duration) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .outputOptions([
        '-c copy', // Copy streams without re-encoding for speed
        '-avoid_negative_ts make_zero',
      ])
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', reject)
      .run();
  });
};

export const compressVideo = (inputPath, outputPath, quality = 'medium') => {
  return new Promise((resolve, reject) => {
    const crfValues = {
      low: 28,
      medium: 23,
      high: 18,
    };

    ffmpeg(inputPath)
      .outputOptions([
        `-c:v libx264`,
        `-preset medium`,
        `-crf ${crfValues[quality] || 23}`,
        `-c:a aac`,
        `-b:a 128k`,
      ])
      .output(outputPath)
      .on('progress', (progress) => {
        logger.debug(`Compression progress: ${progress.percent}%`);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', reject)
      .run();
  });
};

export const extractAudio = (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vn', // No video
        '-acodec mp3',
        '-ab 192k',
      ])
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', reject)
      .run();
  });
};

export const createGif = (videoPath, outputPath, startTime = 0, duration = 3) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(startTime)
      .duration(duration)
      .outputOptions([
        '-vf scale=480:-1',
        '-r 10', // 10 FPS
      ])
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', reject)
      .run();
  });
};
