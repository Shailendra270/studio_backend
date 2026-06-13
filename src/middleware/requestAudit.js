import crypto from "crypto";
import logger from "../utils/logger.js";
import { buildBaseAuditFromRequest, writeAuditLog } from "../services/auditLogService.js";

export function requestTracking(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}

export function requestAuditLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const responseTime = Date.now() - start;
    logger.logRequest(req, res, responseTime);

    writeAuditLog({
      ...buildBaseAuditFromRequest(req),
      action: "request",
      entity: "http_request",
      entityId: req.requestId,
      statusCode: res.statusCode,
      metadata: {
        responseTimeMs: responseTime,
        query: req.query,
      },
    });
  });

  next();
}
