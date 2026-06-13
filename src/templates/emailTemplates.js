/**
 * Email HTML templates. Use with emailService.sendMail().
 * Dark theme, theme colors, inline styles for email client compatibility.
 */

const BRAND_PRIMARY = '#0051FF';
const BRAND_SECONDARY = '#00BBFF';
const BRAND_GRADIENT = `linear-gradient(135deg, ${BRAND_PRIMARY} 0%, ${BRAND_SECONDARY} 100%)`;
const BG_DARK = '#18191B';
const BG_CARD = '#1A1B1E';
const BG_CARD_BORDER = '#252525';
const BORDER_SUBTLE = '#2A2A2A';
const TEXT_WHITE = '#FFFFFF';
const TEXT_MUTED = '#9CA3AF';
const TEXT_FOOTER = '#6B7280';
const LINK_COLOR = '#00BBFF';
const CTA_GRADIENT = `linear-gradient(90deg, ${BRAND_SECONDARY}, ${BRAND_PRIMARY})`;

const DEFAULT_BASE_URL = 'https://www.zentag.ai';
const DEFAULT_LOGIN_PATH = '/login';
const DEFAULT_PRIVACY_PATH = '/privacy';
const DEFAULT_TERMS_PATH = '/terms';
const DEFAULT_CONTACT_PATH = '/contact';

/**
 * Organization invite / new user welcome email — professional dark theme, logo, footer links.
 * @param {Object} opts
 * @param {string} opts.recipientName - Display name of the recipient
 * @param {string} opts.orgName - Name of the organization they were added to
 * @param {string} [opts.loginUrl] - Full URL to login/sign-in page
 * @param {string} [opts.inviterName] - Name of person who added them (optional)
 * @param {boolean} [opts.isNewUser] - If true, CTA says "Sign in to your account"
 * @param {string} [opts.logoUrl] - Full URL to platform logo image (optional)
 * @param {string} [opts.baseUrl] - Base URL for footer links (e.g. https://www.zentag.ai)
 * @param {string} [opts.privacyUrl] - Full URL to Privacy Policy
 * @param {string} [opts.termsUrl] - Full URL to Terms of Use
 * @param {string} [opts.contactUrl] - Full URL to Contact / Help
 */
export function getOrgInviteEmailHtml({
  recipientName,
  orgName,
  loginUrl,
  inviterName,
  isNewUser,
  logoUrl,
  baseUrl = DEFAULT_BASE_URL,
  privacyUrl,
  termsUrl,
  contactUrl,
}) {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const loginLink = loginUrl || `${base}${DEFAULT_LOGIN_PATH}`;
  const privacyLink = privacyUrl || `${base}${DEFAULT_PRIVACY_PATH}`;
  const termsLink = termsUrl || `${base}${DEFAULT_TERMS_PATH}`;
  const contactLink = contactUrl || `${base}${DEFAULT_CONTACT_PATH}`;

  const inviterLine = inviterName
    ? `You were added by <strong style="color:${TEXT_WHITE}">${escapeHtml(inviterName)}</strong>.`
    : 'You have been added to the organization.';
  const ctaLabel = isNewUser ? 'Sign in to your account' : 'Go to sign in';

  const headerContent = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="Zentag" width="140" height="40" style="display:block; max-width:140px; height:auto;" />`
    : `<span style="font-size:24px; font-weight:700; color:${TEXT_WHITE}; letter-spacing:-0.5px;">Zentag</span>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>You've been added to ${escapeHtml(orgName)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${BG_DARK}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <div style="display:none; max-height:0; overflow:hidden;">You've been added to ${escapeHtml(orgName)} on Zentag. Sign in to get started.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${BG_DARK}; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
          <!-- Header with logo -->
          <tr>
            <td style="background: ${BRAND_GRADIENT}; padding: 28px 40px; text-align: center; border-radius: 12px 12px 0 0; border: 1px solid ${BORDER_SUBTLE}; border-bottom: none;">
              ${headerContent}
            </td>
          </tr>
          <!-- Card body -->
          <tr>
            <td style="background-color: ${BG_CARD}; padding: 40px 40px 36px; border-left: 1px solid ${BG_CARD_BORDER}; border-right: 1px solid ${BG_CARD_BORDER};">
              <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: ${TEXT_WHITE}; line-height: 1.3; letter-spacing: -0.02em;">
                You're in — ${escapeHtml(orgName)}
              </h1>
              <div style="height: 4px; width: 48px; background: ${BRAND_GRADIENT}; border-radius: 2px; margin-bottom: 28px;"></div>
              <p style="margin: 0 0 20px; font-size: 16px; color: ${TEXT_MUTED}; line-height: 1.65;">
                Hi ${escapeHtml(recipientName)},
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; color: ${TEXT_MUTED}; line-height: 1.65;">
                ${inviterLine} You now have access to <strong style="color: ${TEXT_WHITE};">${escapeHtml(orgName)}</strong> on Zentag.
              </p>
              <p style="margin: 0 0 32px; font-size: 16px; color: ${TEXT_MUTED}; line-height: 1.65;">
                Sign in below to start using streams, highlights, and publishing.
              </p>
              <!-- CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0;">
                <tr>
                  <td style="border-radius: 10px; background: ${CTA_GRADIENT}; box-shadow: 0 4px 14px rgba(0, 81, 255, 0.35);">
                    <a href="${escapeHtml(loginLink)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 600; color: ${TEXT_WHITE}; text-decoration: none;">
                      ${ctaLabel}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 32px 0 0; font-size: 14px; color: ${TEXT_FOOTER}; line-height: 1.5;">
                If you didn't expect this invite, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer with links -->
          <tr>
            <td style="background-color: ${BG_CARD}; padding: 28px 40px 32px; border: 1px solid ${BG_CARD_BORDER}; border-top: 1px solid ${BORDER_SUBTLE}; border-radius: 0 0 12px 12px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <a href="${escapeHtml(privacyLink)}" target="_blank" rel="noopener noreferrer" style="font-size: 13px; color: ${LINK_COLOR}; text-decoration: none; padding: 0 12px;">Privacy Policy</a>
                    <span style="color: ${TEXT_FOOTER}; font-size: 13px;">&nbsp;·&nbsp;</span>
                    <a href="${escapeHtml(termsLink)}" target="_blank" rel="noopener noreferrer" style="font-size: 13px; color: ${LINK_COLOR}; text-decoration: none; padding: 0 12px;">Terms of Use</a>
                    <span style="color: ${TEXT_FOOTER}; font-size: 13px;">&nbsp;·&nbsp;</span>
                    <a href="${escapeHtml(contactLink)}" target="_blank" rel="noopener noreferrer" style="font-size: 13px; color: ${LINK_COLOR}; text-decoration: none; padding: 0 12px;">Contact</a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="font-size: 12px; color: ${TEXT_FOOTER};">
                    &copy; ${new Date().getFullYear()} Zentag. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

/**
 * Plain text version of org invite (for non-HTML clients).
 */
export function getOrgInviteEmailText({ recipientName, orgName, loginUrl, baseUrl }) {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const loginLink = loginUrl || `${base}${DEFAULT_LOGIN_PATH}`;
  return (
    `Hi ${recipientName},\n\n` +
    `You have been added to ${orgName} on Zentag.\n\n` +
    `Sign in here: ${loginLink}\n\n` +
    `Privacy: ${base}${DEFAULT_PRIVACY_PATH}\n` +
    `Terms: ${base}${DEFAULT_TERMS_PATH}\n\n` +
    `— Zentag`
  );
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
