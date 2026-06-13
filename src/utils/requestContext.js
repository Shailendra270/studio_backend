import crypto from "crypto";

function normalizeIp(ip) {
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.replace("::ffff:", "");
  return ip;
}

/** True if IP is local/private (not useful for audit in production). */
function isPrivateOrLocal(ip) {
  const s = normalizeIp(ip).trim();
  if (!s) return true;
  if (s === "127.0.0.1" || s === "::1" || s === "localhost") return true;
  if (s.startsWith("10.")) return true;
  if (s.startsWith("172.")) {
    const second = parseInt(s.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (s.startsWith("192.168.")) return true;
  return false;
}

/**
 * Get client IP for audit/logging. Uses proxy headers first so deployed apps
 * behind nginx/load balancer get the real client IP instead of 127.0.0.1.
 * Ensure your proxy sets X-Forwarded-For or X-Real-IP (e.g. nginx:
 * proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 * proxy_set_header X-Real-IP $remote_addr;).
 */
export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    const parts = fwd.split(",").map((p) => normalizeIp(p.trim()));
    const firstPublic = parts.find((p) => p && !isPrivateOrLocal(p));
    if (firstPublic) return firstPublic;
    if (parts[0]) return parts[0];
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    const ip = normalizeIp(realIp.trim());
    if (ip && !isPrivateOrLocal(ip)) return ip;
    if (ip) return ip;
  }
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    const ip = normalizeIp(cfIp.trim());
    if (ip) return ip;
  }
  const fallback = normalizeIp(req.ip || req.socket?.remoteAddress || "");
  return fallback || "";
}

export function getCountryFromRequest(req) {
  // Best-effort country resolution from common proxy/CDN headers.
  const raw =
    req.headers["cf-ipcountry"] ||
    req.headers["x-country-code"] ||
    req.headers["x-geo-country"] ||
    req.headers["x-vercel-ip-country"] ||
    "unknown";
  const value = String(raw || "").trim();
  return value ? value.toUpperCase() : "UNKNOWN";
}

export function getActorId(req) {
  return (
    req.user?._id?.toString?.() ||
    req.user?.id?.toString?.() ||
    req.user?.userId?.toString?.() ||
    "system"
  );
}

export function getRequestId(req) {
  return req.requestId || crypto.randomUUID();
}

export function getAuditStamp(req) {
  const now = new Date();
  return {
    updatedAt: now,
    updatedBy: getActorId(req),
    updatedIp: getClientIp(req),
    updatedCountry: getCountryFromRequest(req),
  };
}

export function getSoftDeleteStamp(req) {
  const now = new Date();
  return {
    isDeleted: true,
    deletedAt: now,
    deletedBy: getActorId(req),
    deletedIp: getClientIp(req),
    deletedCountry: getCountryFromRequest(req),
    updatedAt: now,
    updatedBy: getActorId(req),
    updatedIp: getClientIp(req),
    updatedCountry: getCountryFromRequest(req),
  };
}
