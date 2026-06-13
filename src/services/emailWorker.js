// Background worker for sending emails
import { Worker } from "bullmq";
import dotenv from "dotenv";
import mongoose from "mongoose";
import EmailHistory from "../models/EmailHistory.js";
import Clip from "../models/Clip.js";
import PublishEvent from "../models/PublishEvent.js";
import { sendEmail } from "./emailProvider.js";

dotenv.config();
const MONGO_URI = process.env.MONGO_URI;
const mongoOptions = { maxPoolSize: 5 };  
await mongoose.connect(MONGO_URI, mongoOptions);

const buildConnection = () => {
  let connection = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
  };

  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const u = new URL(url);
      connection = {
        host: u.hostname,
        port: Number(u.port || 6379),
        username: u.username || undefined,
        password: u.password || undefined,
      };
    } catch {}
  }

  // Force IPv4 if localhost is used
  if (connection.host === 'localhost') {
    connection.host = '127.0.0.1';
  }

  return connection;
};

const connection = buildConnection();

export const emailWorker = new Worker(
  "email_send",
  async (job) => {
    const { historyId } = job.data;
    const history = await EmailHistory.findById(historyId);
    if (!history) return;

    await EmailHistory.updateOne({ _id: historyId }, { $set: { status: "RETRYING" } });
    try {
      const result = await sendEmail({
        to: history.to,
        cc: history.cc,
        bcc: history.bcc,
        subject: history.subject,
        html: history.html,
        text: history.text,
        attachments: history.attachments,
      });

      const sentAt = new Date();
      await EmailHistory.updateOne(
        { _id: historyId },
        {
          $set: {
            status: "SENT",
            sentAt,
            provider: result.provider,
            recipients: history.recipients.map((r) => ({ ...r, status: "sent", deliveryTimestamp: sentAt })),
          },
        }
      );

      if (history.clip?.clipId) {
        await Clip.updateOne(
          { id: history.clip.clipId },
          {
            $push: {
              clipPublished: {
                type: "email",
                platform: "email",
                published: true,
                status: "completed",
              },
            },
          }
        );
      }

      const event = {
        id: job.id,
        contentType: "clip",
        contentId: history.clip?.clipId,
        platform: "email",
        type: "email",
        publisher: "UI",
        publisherId: history.userId,
        status: "completed",
        initiatedAt: history.createdAt,
        publishedAt: sentAt,
        content: {},
        aspectRatio: history.clip?.aspectRatio,
        streamId: history.clip?.streamId,
        details: {
          content: { subject: history.subject, body: history.html, isHtml: true },
          recipients: history.recipients,
        },
        publishFiles: [],
      };
      await PublishEvent.create(event);
    } catch (err) {
      await EmailHistory.updateOne(
        { _id: historyId },
        { $set: { status: "FAILED", errorMessage: err?.message || String(err) }, $inc: { retryCount: 1 } }
      );
      throw err;
    }
  },
  { connection }
);

export default emailWorker;
