import mongoose from 'mongoose';
import User from './src/models/User.js';

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/dev-zentag');
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const checkUsers = async () => {
  await connectDB();
  
  try {
    const users = await User.find({}, { email: 1, name: 1, _id: 1, active: 1 }).limit(10);
    console.log('Found users:');
    console.log(users);
    
    const userCount = await User.countDocuments();
    console.log(`\nTotal users in database: ${userCount}`);
    
    // Check specifically for test@example.com
    const testUser = await User.findOne({ email: 'test@example.com' }, { email: 1, name: 1, active: 1, password: 1 }).select('+password');
    if (testUser) {
      console.log('\ntest@example.com user found:');
      console.log({
        email: testUser.email,
        name: testUser.name,
        active: testUser.active,
        hasPassword: !!testUser.password
      });
    } else {
      console.log('\ntest@example.com user NOT found');
    }
  } catch (error) {
    console.error('Error checking users:', error);
  }
  
  mongoose.connection.close();
};

checkUsers();

