import Stream from "../models/Stream.js";
import Clip from "../models/Clip.js";

export const DEFAULT_AI_HOST = "34.14.203.238";

export const AI_SERVER_URL = (host) => `http://${host || DEFAULT_AI_HOST}:5003`;
export const AI_CONVERTER_URL = (host) => `http://${host || DEFAULT_AI_HOST}:5004/ai_converter`;

export const resolveHostByStreamId = async (streamId) => {
  try {
    if (!streamId) return DEFAULT_AI_HOST;
    const st = await Stream.findOne({ $or: [{ streamId }, { id: streamId }] });
    if (st && st.isLive && st.server_address) return st.server_address;
    return DEFAULT_AI_HOST;
  } catch {
    return DEFAULT_AI_HOST;
  }
};

export const resolveHostByClipId = async (clipId) => {
  try {
    const clip = await Clip.findOne({ $or: [{ id: clipId }, { _id: clipId }] });
    return resolveHostByStreamId(clip?.streamId);
  } catch {
    return DEFAULT_AI_HOST;
  }
};

export const resolveHostByJobId = async (jobId) => {
  try {
    const clip = await Clip.findOne({ jobId });
    return resolveHostByStreamId(clip?.streamId);
  } catch {
    return DEFAULT_AI_HOST;
  }
};

