import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";

export const getAuditLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      action,
      entity,
      actorId,
      orgId,
      ip,
      country,
      from,
      to,
    } = req.query;

    const query = {};
    if (action) query.action = action;
    if (entity) query.entity = entity;
    if (actorId) query.actorId = actorId;
    if (orgId) query.orgId = orgId;
    if (ip) query.ip = ip;
    if (country) query.country = String(country).toUpperCase();
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate("orgId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    // Resolve actorId -> user name (for Actor column); hide ip and country in response
    const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))].filter(
      (id) => id !== "system"
    );
    const actorNameMap = {};
    if (actorIds.length > 0) {
      const isMongoId = (id) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
      const mongoIds = actorIds.filter(isMongoId);
      const otherIds = actorIds.filter((id) => !isMongoId(id));
      const users = await User.find({
        $or: [
          ...(mongoIds.length ? [{ _id: { $in: mongoIds.map((id) => new mongoose.Types.ObjectId(id)) } }] : []),
          ...(otherIds.length ? [{ userId: { $in: otherIds } }] : []),
        ],
      })
        .select("_id userId name")
        .lean();
      for (const u of users) {
        const id = u._id?.toString?.() || u.userId;
        if (id && u.name) actorNameMap[id] = u.name;
        if (u.userId && u.name) actorNameMap[u.userId] = u.name;
      }
    }
    const safeLogs = logs.map((log) => {
      const { ip: _ip, country: _country, ...rest } = log;
      const actorName = log.actorId === "system" ? "system" : (actorNameMap[log.actorId] ?? log.actorId ?? "—");
      return { ...rest, actorName };
    });

    return res.status(200).json({
      success: true,
      data: {
        logs: safeLogs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch audit logs",
      error: error.message,
    });
  }
};
