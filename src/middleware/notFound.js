import { AppError } from './errorHandler.js';

export const notFound = (req, res, next) => {
  const message = `Route ${req.originalUrl} not found`;
  const error = new AppError(message, 404);
  next(error);
};
