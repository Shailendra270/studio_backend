import AuditLog from "../models/AuditLog.js";
import logger from "../utils/logger.js";
import { getActorId, getClientIp, getCountryFromRequest, getRequestId } from "../utils/requestContext.js";

export function writeAuditLog(payload) {
  // Non-blocking write to avoid impacting request latency.
  Promise.resolve()
    .then(() => AuditLog.create(payload))
    .catch((error) => {
      logger.warn("Audit log write failed", { error: error.message });
    });
}

/**
 * Write a monitor log (API failure, AI push, missing objects). Runs in background; does not throw.
 * @param {object} entry - { action: 'api_failure'|'ai_push'|'missing_objects', entity, entityId?, orgId?, metadata?, ... }
 * @param {object} [req] - Optional request to attach requestId, path, actorId, ip, etc.
 */
export function writeMonitorLog(entry, req = null) {
  const base = req ? buildBaseAuditFromRequest(req) : {};
  const payload = {
    ...base,
    action: entry.action,
    entity: entry.entity ?? "monitor",
    entityId: entry.entityId ?? null,
    orgId: entry.orgId ?? base.orgId ?? null,
    statusCode: entry.statusCode ?? null,
    metadata: entry.metadata || {},
    before: entry.before ?? null,
    after: entry.after ?? null,
  };
  Promise.resolve()
    .then(() => AuditLog.create(payload))
    .catch((error) => {
      logger.warn("Monitor log write failed", { error: error.message });
    });
}

export function buildBaseAuditFromRequest(req) {
  return {
    requestId: getRequestId(req),
    actorId: getActorId(req),
    ip: getClientIp(req),
    country: getCountryFromRequest(req),
    method: req.method,
    path: req.originalUrl,
    userAgent: req.get("User-Agent") || "",
  };
}
