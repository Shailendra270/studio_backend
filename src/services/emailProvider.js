// Abstraction over email providers (SendGrid primary, SMTP fallback)
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";

dotenv.config();

const PROVIDER = (process.env.EMAIL_PROVIDER || "smtp").toLowerCase();

const sendViaSendGrid = async ({ to, cc, bcc, subject, html, text, attachments }) => {
  sgMail.setApiKey(String(process.env.SENDGRID_API_KEY));
  const msg = {
    to,
    cc,
    bcc,
    from: process.env.EMAIL_FROM || "noreply@zentag.ai",
    subject,
    html,
    text,
    attachments: (attachments || []).map((a) => ({
      filename: a.fileName,
      type: a.mimeType,
      content: a.contentBase64,
      disposition: "attachment",
    })),
  };
  const resp = await sgMail.send(msg);
  return { provider: "sendgrid", response: resp };
};

const sendViaSMTP = async ({ to, cc, bcc, subject, html, text, attachments }) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "127.0.0.1",
    port: Number(process.env.SMTP_PORT || 1025),
    secure: Boolean(process.env.SMTP_SECURE === "true"),
    connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT_MS || 2000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 4000),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@zentag.ai",
    to: (to || []).join(","),
    cc: (cc || []).join(","),
    bcc: (bcc || []).join(","),
    subject,
    html,
    text,
    attachments: (attachments || []).map((a) => ({ filename: a.fileName, contentType: a.mimeType, path: a.storageUrl })),
  });
  return { provider: "smtp", response: info };
};

export const sendEmail = async ({ to = [], cc = [], bcc = [], subject, html, text, attachments = [] }) => {
  const canSendGrid = Boolean(process.env.SENDGRID_API_KEY);
  const primary = PROVIDER === "debug" ? "debug" : ((PROVIDER === "sendgrid" && canSendGrid) ? "sendgrid" : "smtp");
  const alt = primary === "sendgrid" ? "smtp" : (primary === "smtp" && canSendGrid ? "sendgrid" : null);

  try {
    if (primary === "sendgrid") {
      return await sendViaSendGrid({ to, cc, bcc, subject, html, text, attachments });
    }
    if (primary === "smtp") {
      return await sendViaSMTP({ to, cc, bcc, subject, html, text, attachments });
    }
    // debug provider
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || "noreply@zentag.ai",
      to: (to || []).join(","),
      cc: (cc || []).join(","),
      bcc: (bcc || []).join(","),
      subject,
      html,
      text,
    });
    return { provider: "debug", response: info };
  } catch (err) {
    if (alt) {
      return alt === "sendgrid"
        ? await sendViaSendGrid({ to, cc, bcc, subject, html, text, attachments })
        : await sendViaSMTP({ to, cc, bcc, subject, html, text, attachments });
    }
    throw err;
  }
};

export default sendEmail;
