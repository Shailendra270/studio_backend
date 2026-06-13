// Email queue built on BullMQ
import { Queue } from "bullmq";
import dotenv from "dotenv";

dotenv.config();

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

export const emailQueue = new Queue("email_send", { connection });

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("QUEUE_TIMEOUT")), ms));

export const enqueueEmail = async (data, opts = {}) => {
  if (String(process.env.EMAIL_QUEUE_ENABLED || "true").toLowerCase() === "false") {
    throw new Error("QUEUE_DISABLED");
  }
  const t = Number(process.env.EMAIL_QUEUE_TIMEOUT_MS || 1500);
  return Promise.race([
    emailQueue.add("send", data, {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false,
      ...opts,
    }),
    timeout(t),
  ]);
};

export default emailQueue;
