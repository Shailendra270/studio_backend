import express from "express";
import { protect, restrictTo } from "../middleware/auth.js";
import { getAuditLogs } from "../controllers/auditLogsController.js";

const router = express.Router();

router.use(protect);
router.use(restrictTo("superadmin"));

router.get("/", getAuditLogs);

export default router;
