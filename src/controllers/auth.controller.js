import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import Organization from "../models/Organization.js";
import OrganizationMember from "../models/OrganizationMember.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";
import logger from "../utils/logger.js";
import { computeSoftDeleteRemainingDays } from "../utils/softDeleteGrace.js";

// Parse JWT_EXPIRES_IN to milliseconds (supports "30d", "7d", "24h", or raw seconds like 2592000)
const parseJwtExpiresInMs = () => {
  const raw = (process.env.JWT_EXPIRES_IN || "30d").toString().trim();
  const match = raw.match(/^(\d+)([smhd])$/i); // e.g. 30d, 24h, 60m
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = (match[2] || "d").toLowerCase();
    const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    return num * (multipliers[unit] || multipliers.d);
  }
  const seconds = parseInt(raw, 10);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  return 30 * 24 * 60 * 60 * 1000; // default 30 days in ms
};

// Generate JWT token (expiresIn: string like "30d" or number of seconds)
const signToken = (id) => {
  const raw = (process.env.JWT_EXPIRES_IN || "30d").toString().trim();
  const asSeconds = parseInt(raw, 10);
  const expiresIn = !raw.match(/[a-z]/i) && !Number.isNaN(asSeconds) ? asSeconds : raw;
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn });
};

// Create and send token
const createSendToken = (user, statusCode, req, res, message) => {
  const token = signToken(user._id);
  const jwtExpiresInMs = parseJwtExpiresInMs();

  const cookieOptions = {
    expires: new Date(Date.now() + jwtExpiresInMs),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  };

  res.cookie("jwt", token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: true,
    message: message,
    token,
    data: {
      user,
    },
  });
};

// @desc    Register new user
// @route   POST /api/auth/signup
// @access  Public
export const signup = asyncHandler(async (req, res, next) => {
  const { name, email, password, agreeToTerms } = req.body;

  const normalizedEmail = email.toLowerCase();

  // Check if any user or organization (active or soft-deleted) already uses this email
  const [existingUserAll, existingOrgAll] = await Promise.all([
    User.findOne({ email: normalizedEmail }),
    Organization.findOne({ contactEmail: normalizedEmail }),
  ]);

  const activeUser = existingUserAll && existingUserAll.isDeleted !== true;
  const activeOrg = existingOrgAll && existingOrgAll.isDeleted !== true;

  if (activeUser || activeOrg) {
    return next(
      new AppError(
        "This email is already in use in the system. Please use a new email.",
        400
      )
    );
  }

  const candidate = existingUserAll || existingOrgAll;
  if (candidate && candidate.isDeleted === true) {
    // For older records that don't have deletedAt yet, fall back to updatedAt/createdAt
    const deletedRef = candidate.deletedAt || candidate.updatedAt || candidate.createdAt;
    if (deletedRef) {
      const { withinGrace, remainingDays } = computeSoftDeleteRemainingDays(deletedRef);
      if (withinGrace) {
        const plural = remainingDays === 1 ? "day" : "days";
        return next(
          new AppError(
            `This account with this email was recently deleted. Please wait ${remainingDays} more ${plural} or use a new email.`,
            400
          )
        );
      }
    }
  }

  // Create new user
  const newUser = await User.create({
    name,
    email: normalizedEmail,
    password,
  });

  // Create email verification token
  const verifyToken = newUser.createEmailVerificationToken();
  await newUser.save({ validateBeforeSave: false });

  logger.info(`New user registered: ${email}`);
  const message = "User registered successfully!.";
  createSendToken(newUser, 201, req, res, message);
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Look up user first
  const user = await User.findOne({ email, isDeleted: { $ne: true } }).select("+password +active");

  if (!user) {
    return next(
      new AppError(
        "No account found for this email. Please reach out to your administrator.",
        401,
      ),
    );
  }

  // Account-level inactive
  if (!user.active) {
    return next(
      new AppError(
        "Your account is inactive. Please reach out to your organization admin.",
        401,
      ),
    );
  }

  // Finally, validate password
  const passwordOk = await user.correctPassword(password, user.password);
  if (!passwordOk) {
    return next(new AppError("Incorrect email or password", 401));
  }

  /*
  // Org / membership checks before password so we surface the right message
  if (user.role !== 'superadmin') {
    const membership = await OrganizationMember.findOne({
      user: user._id,
      status: 'Active',
    })
      .select('organization')
      .sort({ joinedAt: 1 })
      .lean();

    if (!membership) {
      return next(
        new AppError(
          "Your account is inactive. Please reach out to your organization admin.",
          403,
        ),
      );
    }

    const org = await Organization.findById(membership.organization).select('status').lean();
    if (org?.status === 'Suspended') {
      return next(
        new AppError(
          "This organization has been suspended. Please reach out to your administrator.",
          403,
        ),
      );
    }
  }
  */

  // Update last login
  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  logger.info(`User logged in: ${email}`);
  const message = "Login successful";
  createSendToken(user, 200, req, res, message);
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Public
export const logout = (req, res) => {
  res.cookie("jwt", "", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });

  res.status(200).json({
    status: true,
    message: "Logged out successfully",
  });
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req, res, next) => {
  const userObj = req.user.toObject ? req.user.toObject() : { ...req.user };
  if (req.user.role === 'superadmin') {
    userObj.permissions = null; // full access for superadmin
  } else {
    /*
    const membership = await OrganizationMember.findOne({ user: req.user._id, status: 'Active' })
      .select('organization role')
      .populate('role')
      .sort({ joinedAt: 1 })
      .lean();
    if (membership?.organization) {
      const org = await Organization.findById(membership.organization).select('_id name logoUrl').lean();
      if (org) {
        userObj.defaultOrganization = {
          id: org._id.toString(),
          name: org.name,
          logoUrl: org.logoUrl || null,
        };
      }
    }
    // Attach role permissions for frontend (same shape as RolePermissionMatrix)
    userObj.permissions = {
      'Dashboard': { view: true, create: true, edit: true, delete: true },
      'Streams / Live': { view: true, create: true, edit: true, delete: true },
      'Clips': { view: true, create: true, edit: true, delete: true },
      'Highlights': { view: true, create: true, edit: true, delete: true },
      'Folders': { view: true, create: true, edit: true, delete: true },
      'Published': { view: true, create: true, edit: true, delete: true },
      'Assets': { view: true, create: true, edit: true, delete: true },
      'Tags': { view: true, create: true, edit: true, delete: true },
      'Templates': { view: true, create: true, edit: true, delete: true },
      'Settings': { view: true, create: true, edit: true, delete: true },
      'Teams': { view: true, create: true, edit: true, delete: true },
      'Competitions': { view: true, create: true, edit: true, delete: true },
      'Users': { view: true, create: true, edit: true, delete: true },
      'Roles & Permissions': { view: true, create: true, edit: true, delete: true },
    };
    */
    userObj.permissions = {
      'Dashboard': { view: true, create: true, edit: true, delete: true },
      'Streams / Live': { view: true, create: true, edit: true, delete: true },
      'Clips': { view: true, create: true, edit: true, delete: true },
      'Highlights': { view: true, create: true, edit: true, delete: true },
      'Folders': { view: true, create: true, edit: true, delete: true },
      'Published': { view: true, create: true, edit: true, delete: true },
      'Assets': { view: true, create: true, edit: true, delete: true },
      'Tags': { view: true, create: true, edit: true, delete: true },
      'Templates': { view: true, create: true, edit: true, delete: true },
      'Settings': { view: true, create: true, edit: true, delete: true },
      'Teams': { view: true, create: true, edit: true, delete: true },
      'Competitions': { view: true, create: true, edit: true, delete: true },
      'Users': { view: true, create: true, edit: true, delete: true },
      'Roles & Permissions': { view: true, create: true, edit: true, delete: true },
    };
  }
  res.status(200).json({
    status: true,
    message: "User fetched successfully",
    data: {
      user: userObj,
    },
  });
});

// @desc    Update password
// @route   PATCH /api/auth/update-password
// @access  Private
export const updatePassword = asyncHandler(async (req, res, next) => {
  // Get user from collection
  const user = await User.findById(req.user.id).select("+password");

  // Check if posted current password is correct
  if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
    return next(new AppError("Your current password is incorrect", 401));
  }

  // Update password
  user.password = req.body.password;
  await user.save();

  logger.info(`Password updated for user: ${user.email}`);
  const message = "Password updated successfully!.";
  createSendToken(user, 200, req, res, message);
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = asyncHandler(async (req, res, next) => {
  // Get user based on posted email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError("There is no user with that email address", 404));
  }

  // Generate random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // Send it to user's email
  try {
    const resetURL = `${req.protocol}://${req.get(
      "host",
    )}/api/auth/reset-password/${resetToken}`;

    // TODO: Send email with reset URL
    logger.info(
      `Password reset requested for: ${user.email}, Reset URL: ${resetURL}`,
    );

    res.status(200).json({
      status: true,
      message: "Password reset token sent to email!",
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError(
        "There was an error sending the email. Try again later.",
        500,
      ),
    );
  }
});

// @desc    Reset password
// @route   PATCH /api/auth/reset-password/:token
// @access  Public
export const resetPassword = asyncHandler(async (req, res, next) => {
  // Get user based on the token
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
    isDeleted: { $ne: true },
  });

  // If token has not expired, and there is user, set the new password
  if (!user) {
    return next(new AppError("Token is invalid or has expired", 400));
  }

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  logger.info(`Password reset successful for user: ${user.email}`);
  const message = "Password reset successfully!.";
  createSendToken(user, 200, req, res, message);
});

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
export const verifyEmail = asyncHandler(async (req, res, next) => {
  // Get user based on the token
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
    isDeleted: { $ne: true },
  });

  if (!user) {
    return next(new AppError("Token is invalid or has expired", 400));
  }

  // Update user verification status
  user.emailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`Email verified for user: ${user.email}`);

  res.status(200).json({
    status: true,
    message: "Email verified successfully!",
  });
});

// @desc    Refresh token
// @route   POST /api/auth/refresh-token
// @access  Public
export const refreshToken = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(new AppError("Your session has expired or you are not signed in. Please sign in again.", 401));
  }

  try {
    // Try to verify token (this might fail if expired)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(
        new AppError("The user belonging to this token no longer exists", 401),
      );
    }

    // Check if user is active
    if (!user.active) {
      return next(
        new AppError(
          "Your account is inactive. Please reach out to your organization admin.",
          401,
        ),
      );
    }

    /*
    // Non-superadmin: must have Active membership and org not suspended
    if (user.role !== 'superadmin') {
      const membership = await OrganizationMember.findOne({
        user: user._id,
        status: 'Active',
      })
        .select('organization')
        .sort({ joinedAt: 1 })
        .lean();
      if (!membership) {
        return next(
          new AppError(
            "Your account is inactive. Please reach out to your organization admin.",
            403,
          ),
        );
      }
      if (membership.organization) {
        const org = await Organization.findById(membership.organization).select('status').lean();
        if (org?.status === 'Suspended') {
          return next(
            new AppError(
              "This organization has been suspended. Please reach out to your administrator.",
              403,
            ),
          );
        }
      }
    }
    */

    const message = "Token refreshed successfully!";
    createSendToken(user, 200, req, res, message);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      // Token is expired, try to decode without verification to get user ID
      try {
        const decoded = jwt.decode(token);
        if (!decoded || !decoded.id) {
          return next(new AppError("Invalid token format", 401));
        }

        // Check if user still exists
        const user = await User.findById(decoded.id);
        if (!user) {
          return next(
            new AppError(
              "The user belonging to this token no longer exists",
              401,
            ),
          );
        }

        // Check if user is active
        if (!user.active) {
          return next(
            new AppError(
              "Your account is inactive. Please reach out to your organization admin.",
              401,
            ),
          );
        }

        /*
        // Non-superadmin: must have Active membership and org not suspended
        if (user.role !== 'superadmin') {
          const membership = await OrganizationMember.findOne({
            user: user._id,
            status: 'Active',
          })
            .select('organization')
            .sort({ joinedAt: 1 })
            .lean();
          if (!membership) {
            return next(
              new AppError(
                "Your account is inactive. Please reach out to your organization admin.",
                403,
              ),
            );
          }
          if (membership.organization) {
            const org = await Organization.findById(membership.organization).select('status').lean();
            if (org?.status === 'Suspended') {
              return next(
                new AppError(
                  "This organization has been suspended. Please reach out to your administrator.",
                  403,
                ),
              );
            }
          }
        }
        */

        // Issue new token for expired but valid user
        const message = "Expired token refreshed successfully!";
        createSendToken(user, 200, req, res, message);
      } catch (decodeError) {
        return next(new AppError("Invalid token. Please log in again.", 401));
      }
    } else {
      return next(new AppError("Invalid token. Please log in again.", 401));
    }
  }
});
