/**
 * Common email sending service. Use this from anywhere in the app to send emails.
 * Uses the same SMTP/SendGrid configuration as emailProvider (env: SMTP_*, SENDGRID_API_KEY, EMAIL_FROM).
 * If email is not configured, logs and skips sending (no throw).
 */
import { sendEmail } from './emailProvider.js';
import logger from '../utils/logger.js';

/**
 * Send an email. Safe to call even when SMTP/SendGrid is not configured (will log and return).
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email(s)
 * @param {string} options.subject - Subject line
 * @param {string} [options.html] - HTML body
 * @param {string} [options.text] - Plain text body (fallback)
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
export async function sendMail({ to, subject, html, text }) {
  const toList = Array.isArray(to) ? to : [to].filter(Boolean);
  if (!toList.length || !subject) {
    logger.warn('emailService.sendMail: missing to or subject');
    return { sent: false, error: 'missing to or subject' };
  }

  const hasConfig =
    process.env.SMTP_HOST ||
    process.env.SENDGRID_API_KEY ||
    (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase() === 'debug';

  if (!hasConfig) {
    logger.info(`emailService.sendMail: email not configured, skipping. Would send to ${toList.join(', ')} subject "${subject}"`);
    return { sent: false, error: 'email not configured' };
  }

  try {
    await sendEmail({
      to: toList,
      subject,
      html: html || text || '',
      text: text || (html ? html.replace(/<[^>]+>/g, '').trim() : ''),
    });
    logger.info(`emailService.sendMail: sent to ${toList.join(', ')} subject "${subject}"`);
    return { sent: true };
  } catch (err) {
    logger.error('emailService.sendMail error:', err);
    return { sent: false, error: err?.message || 'send failed' };
  }
}

export default sendMail;
