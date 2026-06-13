import express from "express";
import axios from "axios";
import { 
  publishPost, 
  handleWebhook, 
  getHistory, 
  checkPostStatus,
  createProfile,
  getProfiles,
  updateProfile,
  deleteProfile,
  generateJWT
} from "../controllers/socialPublishingController.js";
import { protect } from "../middleware/auth.js"; // Assuming auth middleware is needed

const router = express.Router();

router.post("/generate", async (req, res) => {
  try {
    const payload = req.body || {};
    // Ideally this URL should be in env var
    const resp = await axios.post("http://34.14.203.238:7000/generate", payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    const data = resp?.data || {};
    return res.json({ status: true, data });
  } catch (err) {
    return res.status(502).json({ status: false, message: "AI generate failed", error: String(err?.message || err) });
  }
});

// Social Publishing
router.post("/publish", protect, publishPost);
router.post("/webhook", handleWebhook);
router.get("/history", protect, getHistory);
router.get("/status/:id", protect, checkPostStatus);

// Social Profile Management
router.post("/profiles", protect, createProfile);
router.get("/profiles", protect, getProfiles);
router.put("/profiles/:id", protect, updateProfile);
router.delete("/profiles/:id", protect, deleteProfile);
router.post("/profiles/:id/add-media-platform", protect, generateJWT);

export default router;
