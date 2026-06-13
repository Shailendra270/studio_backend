import mongoose from 'mongoose';
import Clip from './src/models/Clip.js';

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/zentag-dev');
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const checkClipStatus = async () => {
  await connectDB();
  
  try {
    const clip = await Clip.findOne({ jobId: '6b84fad3-fd75-41f9-882b-02326ceac184' });
    if (clip) {
      console.log('Clip found:');
      console.log('clipStatus:', clip.clipStatus);
      console.log('status:', clip.status);
      console.log('progress:', clip.progress);
      console.log('videoUrl:', clip.videoUrl);
      console.log('thumbnailUrl:', clip.thumbnailUrl);
      console.log('thumbnails:', clip.thumbnails);
    } else {
      console.log('Clip not found');
    }
  } catch (error) {
    console.error('Error checking clip:', error);
  }
  
  mongoose.connection.close();
};

checkClipStatus();