import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import shortid from 'shortid';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't include password in queries by default
  },
  avatar: {
    type: String,
    default: null
  },
  // User fields as per your requirements
  userId: { type: String, default: shortid.generate, unique: true },
  isBillingAdmin: { type: String, default: "false" },
  photo: { type: String, default: "" },
  role: { type: String, default: "user" },
  features: { type: [String], default: [] },
  permissions: { type: [String], default: [] },
  timezoneRegion: { type: String },
  sports: { type: [String], default: [] },
  streamProcessLimit: { type: Number, default: 1 },
  
  // Minimal subscription info
  status: {
    type: String,
    enum: ['active', 'cancelled', 'expired', 'trial'],
    default: 'active'
  },
  
  // Basic security fields (minimal for authentication to work)
  active: {
    type: Boolean,
    default: true
  },
  // Soft delete fields – when true, user is treated as deleted
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  deletedBy: { type: String, default: "" },
  deletedIp: { type: String, default: "" },
  deletedCountry: { type: String, default: "UNKNOWN" },
  updatedBy: { type: String, default: "" },
  updatedIp: { type: String, default: "" },
  updatedCountry: { type: String, default: "UNKNOWN" },
  lastLogin: {
    type: Date,
    default: Date.now
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date
}, { 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.passwordResetToken;
      delete ret.passwordResetExpires;
      delete ret.emailVerificationToken;
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance
// Ensure email is unique only for non-deleted users
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);
// userId already has unique: true on the field
userSchema.index({ active: 1 });
userSchema.index({ isDeleted: 1 });
userSchema.index({ isDeleted: 1, deletedAt: 1 });

// ESSENTIAL: Password hashing middleware (must be active for auth to work)
userSchema.pre('save', async function(next) {
  // Only run this function if password was actually modified
  if (!this.isModified('password')) return next();
  
  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ESSENTIAL: Set password changed timestamp
userSchema.pre('save', function(next) {
  if (!this.isModified('password') || this.isNew) return next();
  
  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// ESSENTIAL: Password comparison method (required for login)
userSchema.methods.correctPassword = async function(candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

// ESSENTIAL: Check if password changed after JWT issued
userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Password reset token creation (optional but used by auth controller)
userSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  
  return resetToken;
};

// Email verification token creation (optional but used by auth controller)
userSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
    
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  
  return verificationToken;
};

const User = mongoose.model('User', userSchema);

export default User;
