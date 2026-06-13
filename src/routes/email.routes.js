import express from "express";
import { body, validationResult, query } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import EmailHistory from "../models/EmailHistory.js";
import { enqueueEmail } from "../services/emailQueue.js";

const router = express.Router();

router.post(
  "/send",
  [
    body("to").isArray().optional({ nullable: true }),
    body("cc").isArray().optional({ nullable: true }),
    body("bcc").isArray().optional({ nullable: true }),
    body("subject").isString().notEmpty(),
    body("html").isString().optional({ nullable: true }),
    body("text").isString().optional({ nullable: true }),
    body("attachments").isArray().optional({ nullable: true }),
    body("clip").isObject().optional({ nullable: true }),
    body("userId").isString().optional({ nullable: true }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: false, errors: errors.array() });
    const emailId = uuidv4();
    const {
      to = [],
      cc = [],
      bcc = [],
      subject,
      html = "",
      text = "",
      attachments = [],
      clip = {},
      userId = "",
    } = req.body;

    const recipients = [
      ...to.map((address) => ({ address, type: "to" })),
      ...cc.map((address) => ({ address, type: "cc" })),
      ...bcc.map((address) => ({ address, type: "bcc" })),
    ];

    const history = await EmailHistory.create({
      emailId,
      userId,
      to,
      cc,
      bcc,
      subject,
      html,
      text,
      attachments,
      recipients,
      clip,
      status: "PENDING",
    });

    try {
      const job = await enqueueEmail({ historyId: history._id });
      return res.json({ status: true, data: { id: String(history._id), jobId: job.id } });
    } catch (err) {
      // Fallback: queue unavailable; send synchronously for development
      try {
        const { sendEmail } = await import("../services/emailProvider.js");
        const { default: PublishEvent } = await import("../models/PublishEvent.js");
        const { default: Clip } = await import("../models/Clip.js");

        await EmailHistory.updateOne({ _id: history._id }, { $set: { status: "RETRYING" } });
        const result = await sendEmail({ to, cc, bcc, subject, html, text, attachments });
        const sentAt = new Date();
        await EmailHistory.updateOne(
          { _id: history._id },
          {
            $set: {
              status: "SENT",
              sentAt,
              provider: result.provider,
              recipients: recipients.map((r) => ({ ...r, status: "sent", deliveryTimestamp: sentAt })),
            },
          }
        );
        if (clip?.clipId) {
          await Clip.updateOne(
            { id: clip.clipId },
            { $push: { clipPublished: { type: "email", platform: "email", published: true, status: "completed" } } }
          );
        }
        const event = {
          id: String(history._id),
          contentType: "clip",
          contentId: clip?.clipId,
          platform: "email",
          type: "email",
          publisher: "UI",
          publisherId: userId,
          status: "completed",
          initiatedAt: history.createdAt,
          publishedAt: sentAt,
          content: {},
          aspectRatio: clip?.aspectRatio,
          streamId: clip?.streamId,
          details: { content: { subject, body: html, isHtml: true }, recipients },
          publishFiles: [],
        };
        await PublishEvent.create(event);
        return res.json({ status: true, data: { id: String(history._id), jobId: null, fallback: true } });
      } catch (sendErr) {
        await EmailHistory.updateOne(
          { _id: history._id },
          { $set: { status: "FAILED", errorMessage: sendErr?.message || String(sendErr) }, $inc: { retryCount: 1 } }
        );
        return res.status(500).json({ status: false, message: "Queue unavailable and send failed", error: String(sendErr) });
      }
    }
  }
);

router.get(
  "/history",
  [
    query("page").toInt().optional(),
    query("limit").toInt().optional(),
    query("status").optional(),
    query("userId").optional(),
    query("startDate").optional(),
    query("endDate").optional(),
  ],
  async (req, res) => {
    const { page = 1, limit = 20, status, userId, startDate, endDate } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.userId = userId;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(String(startDate));
      if (endDate) filter.createdAt.$lte = new Date(String(endDate));
    }
    const [items, total] = await Promise.all([
      EmailHistory.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      EmailHistory.countDocuments(filter),
    ]);
    return res.json({ status: true, data: { items, page, limit, total, totalPages: Math.ceil(total / limit) } });
  }
);

router.get("/:id", async (req, res) => {
  const history = await EmailHistory.findById(req.params.id);
  if (!history) return res.status(404).json({ status: false, message: "Not found" });
  return res.json({ status: true, data: history });
});

export default router;
