import mongoose from 'mongoose';
import axios from 'axios';
import ChatThread from '../../models/ChatThread.js';
import Clip from '../../models/Clip.js';
import Stream from '../../models/Stream.js';
import AuditLog from '../../models/AuditLog.js';
import OrganizationMember from '../../models/OrganizationMember.js';
import { AppError } from '../../middleware/errorHandler.js';
import logger from '../../utils/logger.js';

const openAiApiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const explicitProvider = (process.env.AI_PROVIDER || process.env.CHAT_AI_PROVIDER || '').trim().toLowerCase();
const aiProvider = explicitProvider || 'ollama';

const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const ollamaModel = process.env.OLLAMA_MODEL || process.env.LOCAL_AI_MODEL || 'llama3.1';

const responseCache = new Map();

const normalizeCacheKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 500);

const setCache = (key, value, ttlMs) => {
  responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

const getCache = (key) => {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
};

const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getOrgIdForUser = async (user) => {
  /*
  if (!user || user.role === 'superadmin') return null;
  const membership = await OrganizationMember.findOne({
    user: user._id,
    status: 'Active',
  })
    .select('organization')
    .sort({ joinedAt: 1 })
    .lean();
  return membership?.organization || null;
  */
  return null;
};

const searchClips = async ({ orgId, query, streamId, limit }) => {
  const safeLimit = Math.max(1, Math.min(Number(limit || 10), 20));
  const q = String(query || '').trim();
  if (!q) return [];

  const filter = {
    isDeleted: false,
    ...(orgId ? { organization: orgId } : {}),
    ...(streamId ? { streamId: String(streamId) } : {}),
    title: { $regex: new RegExp(escapeRegExp(q), 'i') },
  };

  const items = await Clip.find(filter)
    .sort({ updatedAt: -1 })
    .limit(safeLimit)
    .select('_id id title streamId duration start_time end_time tags updatedAt createdAt')
    .lean();

  return items.map((c) => ({
    _id: String(c._id),
    id: c.id,
    title: c.title,
    streamId: c.streamId,
    duration: c.duration,
    start_time: c.start_time,
    end_time: c.end_time,
    tags: c.tags,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  }));
};

const searchStreams = async ({ orgId, query, limit }) => {
  const safeLimit = Math.max(1, Math.min(Number(limit || 10), 20));
  const q = String(query || '').trim();
  if (!q) return [];

  const filter = {
    ...(orgId ? { organization: orgId } : {}),
    $or: [
      { title: { $regex: new RegExp(escapeRegExp(q), 'i') } },
      { streamId: { $regex: new RegExp(escapeRegExp(q), 'i') } },
    ],
  };

  const items = await Stream.find(filter)
    .sort({ updatedAt: -1 })
    .limit(safeLimit)
    .select('_id title streamId isLive status updatedAt createdAt')
    .lean();

  return items.map((s) => ({
    _id: String(s._id),
    title: s.title,
    streamId: s.streamId,
    isLive: s.isLive,
    status: s.status,
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
  }));
};

const getRecentActivity = async ({ orgId, userId, limit }) => {
  const safeLimit = Math.max(1, Math.min(Number(limit || 5), 10));
  const filter = {
    actorId: String(userId),
    ...(orgId ? { orgId } : {}),
  };
  const items = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .select('action entity entityId path statusCode createdAt')
    .lean();
  return items.map((a) => ({
    action: a.action,
    entity: a.entity,
    entityId: a.entityId,
    path: a.path,
    statusCode: a.statusCode,
    createdAt: a.createdAt,
  }));
};

const buildSystemPrompt = ({ user, locale }) => {
  const name = user?.name || '';
  const role = user?.role || 'user';
  const languageHint = locale ? `Preferred language: ${locale}.` : '';

  return [
    'You are a helpful assistant for a video and live-stream content management platform.',
    'You help users manage streams, clips/highlights, folders, tags, templates, publishing to social platforms, and understand RBAC/audit logs.',
    'Be concise, step-by-step, and UI-oriented (mention the likely page/module names).',
    'If you are not certain, ask a focused follow-up question.',
    'Never ask for secrets or credentials. Never reveal API keys or internal secrets.',
    `User context: name=${name || 'unknown'}, role=${role}.`,
    languageHint,
  ]
    .filter(Boolean)
    .join('\n');
};

const maybeAugmentWithSearchContext = async ({ orgId, userMessage }) => {
  const q = String(userMessage || '').trim();
  if (q.length < 3) return [];

  const wantsClips = /\b(clip|clips|highlight|highlights)\b/i.test(q);
  const wantsStreams = /\b(stream|streams|live)\b/i.test(q);
  const wantsFind = /\b(find|search|show|locate)\b/i.test(q);

  if (!wantsFind && !wantsClips && !wantsStreams) return [];

  const [clips, streams] = await Promise.all([
    wantsClips || wantsFind ? searchClips({ orgId, query: q, limit: 8 }).catch(() => []) : Promise.resolve([]),
    wantsStreams || wantsFind ? searchStreams({ orgId, query: q, limit: 8 }).catch(() => []) : Promise.resolve([]),
  ]);

  const parts = [];
  if (clips.length) parts.push({ clips });
  if (streams.length) parts.push({ streams });
  if (!parts.length) return [];

  return [
    {
      role: 'system',
      content: `Search context (may be partial):\n${JSON.stringify(parts)}`,
    },
  ];
};

const openAiChat = async ({ messages, tools }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    throw new AppError('AI provider not configured (missing OPENAI_API_KEY).', 500);
  }

  const payload = {
    model: openAiModel,
    messages,
    temperature: 0.2,
    max_tokens: 600,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
  };

  try {
    const response = await axios.post(openAiApiUrl, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });

    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401) {
      throw new AppError('OpenAI request unauthorized. Check OPENAI_API_KEY.', 502);
    }
    throw new AppError('OpenAI request failed.', 502);
  }
};

const ollamaChat = async ({ messages }) => {
  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/chat`,
      {
        model: ollamaModel,
        messages,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 600,
        },
      },
      { timeout: 60_000 },
    );

    const content = response?.data?.message?.content;
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content,
          },
        },
      ],
    };
  } catch (error) {
    const status = error?.response?.status;
    const detail =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      'Unknown error';
    const msg =
      status === 404
        ? `Local AI provider is reachable but the Ollama /api/chat endpoint was not found at ${ollamaBaseUrl}.`
        : `Local AI provider is not reachable at ${ollamaBaseUrl} (${detail}).`;
    throw new AppError(msg, 503);
  }
};

const chatCompletion = async ({ messages, tools }) => {
  if (aiProvider === 'openai') return openAiChat({ messages, tools });
  if (aiProvider === 'ollama') return ollamaChat({ messages });
  if (aiProvider === 'local-openai' || aiProvider === 'openai-compatible') {
    const localUrl = process.env.LOCAL_OPENAI_URL || process.env.OPENAI_API_URL;
    if (!localUrl) {
      throw new AppError('Local OpenAI-compatible provider URL not configured (LOCAL_OPENAI_URL).', 500);
    }
    const model = process.env.LOCAL_OPENAI_MODEL || openAiModel;
    const response = await axios.post(
      localUrl,
      { model, messages, temperature: 0.2, max_tokens: 600 },
      { timeout: 60_000 },
    );
    return response.data;
  }
  throw new AppError(`Unsupported AI provider: ${aiProvider}`, 500);
};

export const chatWithAssistant = async ({ user, threadId, message, locale }) => {
  const content = String(message || '').trim();
  if (!content) throw new AppError('Message is required.', 400);

  const orgId = await getOrgIdForUser(user);
  const cacheKey = `${String(user?._id)}|${String(orgId || '')}|${normalizeCacheKey(content)}`;
  const cached = getCache(cacheKey);

  const startedAt = Date.now();

  let thread =
    threadId && mongoose.isValidObjectId(threadId)
      ? await ChatThread.findOne({ _id: threadId, user: user._id }).exec()
      : null;

  if (!thread) {
    thread = await ChatThread.create({
      user: user._id,
      orgId,
      messages: [],
      lastMessageAt: new Date(),
    });
  } else if (orgId && !thread.orgId) {
    thread.orgId = orgId;
  }

  thread.messages.push({ role: 'user', content });
  thread.lastMessageAt = new Date();

  if (cached) {
    thread.messages.push({ role: 'assistant', content: cached });
    await thread.save();
    return { threadId: String(thread._id), reply: cached, cached: true };
  }

  const recentActivity = await getRecentActivity({
    orgId,
    userId: user._id,
    limit: 5,
  }).catch(() => []);

  const history = thread.messages
    .slice(-12)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const systemPrompt = buildSystemPrompt({ user, locale });
  const extraContextMessages = await maybeAugmentWithSearchContext({ orgId, userMessage: content });
  const messagesForAi = [
    { role: 'system', content: systemPrompt },
    ...(recentActivity.length
      ? [
          {
            role: 'system',
            content: `Recent activity (most recent first):\n${JSON.stringify(recentActivity)}`,
          },
        ]
      : []),
    ...extraContextMessages,
    ...history,
  ];

  const tools = [
    {
      type: 'function',
      function: {
        name: 'search_clips',
        description: 'Search clips/highlights by title (and optionally streamId). Returns a short list.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            streamId: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_streams',
        description: 'Search streams by title or streamId. Returns a short list.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
    },
  ];

  const runTools = async (toolCalls) => {
    const toolMessages = [];
    for (const call of toolCalls) {
      const name = call?.function?.name;
      const rawArgs = call?.function?.arguments || '{}';
      let args = {};
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }

      let result = null;
      if (name === 'search_clips') {
        result = await searchClips({ orgId, ...args }).catch(() => []);
      } else if (name === 'search_streams') {
        result = await searchStreams({ orgId, ...args }).catch(() => []);
      } else {
        result = { error: `Unknown tool: ${name}` };
      }

      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
    return toolMessages;
  };

  let aiData = await chatCompletion({ messages: messagesForAi, tools: aiProvider === 'openai' ? tools : [] });
  let assistantMessage = aiData?.choices?.[0]?.message;

  for (let i = 0; i < 2; i += 1) {
    if (aiProvider !== 'openai') break;
    const toolCalls = assistantMessage?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) break;

    const toolMessages = await runTools(toolCalls);
    const nextMessages = [
      ...messagesForAi,
      {
        role: 'assistant',
        content: assistantMessage?.content || '',
        tool_calls: toolCalls,
      },
      ...toolMessages,
    ];
    aiData = await chatCompletion({ messages: nextMessages, tools });
    assistantMessage = aiData?.choices?.[0]?.message;
  }

  const reply = String(assistantMessage?.content || '').trim();
  if (!reply) {
    throw new AppError('AI returned an empty response.', 502);
  }

  thread.messages.push({ role: 'assistant', content: reply });
  if (thread.messages.length > 200) {
    thread.messages = thread.messages.slice(-200);
  }
  await thread.save();

  setCache(cacheKey, reply, 5 * 60 * 1000);
  logger.info('Chat reply generated', {
    userId: String(user?._id),
    orgId: orgId ? String(orgId) : null,
    ms: Date.now() - startedAt,
  });

  return { threadId: String(thread._id), reply, cached: false };
};

export const getChatHistory = async ({ user, threadId, limit }) => {
  const safeLimit = Math.max(1, Math.min(Number(limit || 30), 100));
  const query = threadId
    ? { _id: threadId, user: user._id }
    : { user: user._id };

  const thread = await ChatThread.findOne(query).sort({ lastMessageAt: -1 }).lean();
  if (!thread) {
    return { threadId: null, messages: [] };
  }

  const messages = (thread.messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-safeLimit)
    .map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    }));

  return { threadId: String(thread._id), messages };
};
