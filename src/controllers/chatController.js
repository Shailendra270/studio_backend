import { validationResult } from 'express-validator';
import { chatWithAssistant, getChatHistory } from '../services/chat/chat.service.js';
import logger from '../utils/logger.js';

export const chat = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: false,
      message: 'Invalid request',
      errors: errors.array(),
    });
  }

  try {
    const { message, threadId, locale } = req.body || {};
    const result = await chatWithAssistant({
      user: req.user,
      threadId,
      message,
      locale,
    });

    return res.status(200).json({
      status: true,
      threadId: result.threadId,
      reply: result.reply,
      cached: result.cached,
    });
  } catch (error) {
    logger.error('Chat error', { message: error?.message });
    return res.status(error?.statusCode || 500).json({
      status: false,
      message: error?.message || 'Chat failed',
    });
  }
};

export const history = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: false,
      message: 'Invalid request',
      errors: errors.array(),
    });
  }

  try {
    const { threadId, limit } = req.query || {};
    const result = await getChatHistory({
      user: req.user,
      threadId,
      limit,
    });

    return res.status(200).json({
      status: true,
      threadId: result.threadId,
      messages: result.messages,
    });
  } catch (error) {
    logger.error('Chat history error', { message: error?.message });
    return res.status(error?.statusCode || 500).json({
      status: false,
      message: error?.message || 'Failed to fetch chat history',
    });
  }
};
