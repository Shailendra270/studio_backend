import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { PublishErrorType } from "../../config/platform.rules.js";

dotenv.config();

const AYRSHARE_API_URL = "https://api.ayrshare.com/api";
const API_KEY = process.env.AYRSHARE_API_KEY;
const AYRSHARE_DOMAIN = process.env.AYRSHARE_DOMAIN;
const AYRSHARE_PRIVATE_KEY = process.env.AYRSHARE_PRIVATE_KEY;

class AyrshareService {
  constructor() {
    this.client = axios.create({
      baseURL: AYRSHARE_API_URL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      timeout: 300000, // 5 minutes
    });
  }

  /**
   * Post to social media
   * @param {Object} payload - Mapped Ayrshare payload
   * @param {string} [profileKey] - Optional profile key for multi-tenant (Not used with single API Key)
   * @returns {Promise<Object>} Response data
   */
  async post(payload, profileKey = null) {
    const config = {};

    if (profileKey) {
      config.headers = {
        "Profile-Key": profileKey,
      };
    } else {
      console.warn("No profileKey provided for post. Using default API key only (User Profile).");
    }
   console.log(payload,"posting...........................")
    try {
      console.log("Sending request to Ayrshare:", {
        url: `${AYRSHARE_API_URL}/post`,
        headers: {
          ...this.client.defaults.headers.common,
          ...this.client.defaults.headers,
          ...config.headers,
        },
        payload,
      });

      const response = await this.client.post("/post", payload, config);
      return response.data;
    } catch (error) {
      console.error(
        "Ayrshare API Error:",
        error.response?.data || error.message,
      );
      throw error; // Re-throw to be handled by caller
    }
  }

  /**
   * Upload media to Ayrshare gallery by downloading and re-uploading
   * to bypass external access restrictions (e.g. robots.txt)
   * @param {string} fileUrl - External URL of the file to upload
   * @param {string} [profileKey] - Optional profile key
   * @returns {Promise<string>} Internal Ayrshare URL
   */
  async uploadMedia(fileUrl, profileKey = null) {
    try {
      console.log(`Downloading media from: ${fileUrl}`);
      // Download file as stream with a browser-like User-Agent
      const fileResponse = await axios.get(fileUrl, { 
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      const formData = new FormData();
      // Extract filename from URL or default
      const filename = fileUrl.split('/').pop().split('?')[0] || 'media_file';
      
      formData.append('file', fileResponse.data, {
        filename: filename,
        contentType: fileResponse.headers['content-type']
      });

      const headers = {
        ...formData.getHeaders(),
        Authorization: `Bearer ${API_KEY}`
      };

      if (profileKey) {
        headers['Profile-Key'] = profileKey;
      } else {
        console.warn("No profileKey provided for media upload. Using default API key only.");
      }

      console.log(`Uploading media to Ayrshare (multipart) as ${filename}...`);
      
      // Use direct axios call to avoid default JSON content-type of this.client
      const response = await axios.post(`${AYRSHARE_API_URL}/media/upload`, formData, {
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      
      if (response.data?.url || response.data?.accessUrl) {
        const uploadedUrl = response.data.url || response.data.accessUrl;
        console.log(`Media uploaded successfully: ${uploadedUrl}`);
        return uploadedUrl;
      }
      
      console.error("Unexpected Ayrshare upload response:", response.data);
      throw new Error(response.data?.message || "Media upload failed");
    } catch (error) {
      console.error("Ayrshare Media Upload Error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a new user profile
   * @param {string} title - Title of the new profile
   * @returns {Promise<Object>} Response data with profile details
   */
  async createProfile(title) {
    try {
      console.log(`Creating Ayrshare profile: ${title}`);
      const payload = { title };
      const response = await this.client.post("/profiles/create-profile", payload);
      return response.data;
    } catch (error) {
      console.error("Ayrshare Create Profile Error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update an existing user profile
   * @param {string} profileKey - The profile key of the user to update
   * @param {Object} data - Data to update (e.g., title)
   * @returns {Promise<Object>} Response data
   */
  async updateProfile(profileKey, data) {
    try {
      console.log(`Updating Ayrshare profile: ${profileKey}`);
      // According to docs: PATCH /profiles with profileKey in body
      const payload = { 
        profileKey,
        ...data 
      };
      const response = await this.client.patch("/profiles", payload);
      return response.data;
    } catch (error) {
      console.error("Ayrshare Update Profile Error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Delete a user profile
   * @param {string} profileKey - The profile key of the user to delete
   * @returns {Promise<Object>} Response data
   */
  async deleteProfile(profileKey) {
    try {
      console.log(`Deleting Ayrshare profile: ${profileKey}`);
      // According to docs: DELETE /profiles with Profile-Key header
      const headers = { "Profile-Key": profileKey };
      const response = await this.client.delete("/profiles", { headers });
      return response.data;
    } catch (error) {
      console.error("Ayrshare Delete Profile Error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get all user profiles
   * @returns {Promise<Array>} List of profiles
   */
  async getProfiles() {
    try {
      console.log("Fetching all Ayrshare profiles");
      const response = await this.client.get("/profiles");
      return response.data;
    } catch (error) {
      console.error("Ayrshare Get Profiles Error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Generate a JWT for single sign-on to the social linking page
   * @param {string} profileKey - The profile key of the user
   * @returns {Promise<Object>} Response data containing the JWT URL
   */
  async generateJWT(profileKey) {
    try {
      if (!AYRSHARE_DOMAIN || !AYRSHARE_PRIVATE_KEY) {
        throw new Error("Missing AYRSHARE_DOMAIN or AYRSHARE_PRIVATE_KEY environment variables");
      }

      if (!profileKey) {
        throw new Error("Missing profileKey for JWT generation");
      }

      console.log(`[Service] Generating Ayrshare JWT for profileKey: ${profileKey}`);
      
      const payload = {
        domain: AYRSHARE_DOMAIN,
        privateKey: AYRSHARE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Ensure newlines are handled correctly
        profileKey: profileKey
      };
      
      console.log(`[Service] Sending payload to /profiles/generateJWT (domain: ${payload.domain}, profileKey: ${payload.profileKey})`);

      // Use a new axios instance or override headers to avoid Authorization conflict if any
      const response = await axios.post(`${AYRSHARE_API_URL}/profiles/generateJWT`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        }
      });
      
      console.log(`[Service] Ayrshare response:`, response.data);
      return response.data;
    } catch (error) {
      console.error("Ayrshare Generate JWT Error:", error.response?.data || error.message);
      throw error;
    }
  }

  handleAxiosError(error) {
    if (error.response) {
      // API returned error response
      const { status, data } = error.response;
      const message = data.message || data.error || "Unknown error";

      const err = new Error(message);
      err.status = status;
      err.details = data;

      if (status === 400 || status === 422) {
        err.type = PublishErrorType.VALIDATION_ERROR;
      } else if (status === 401 || status === 403) {
        err.type = PublishErrorType.AUTH_ERROR;
      } else if (status === 429) {
        err.type = PublishErrorType.RATE_LIMIT_ERROR;
      } else {
        err.type = PublishErrorType.PLATFORM_ERROR;
      }

      return Promise.reject(err);
    } else if (error.request) {
      // No response received
      const err = new Error("No response from Ayrshare API");
      err.type = PublishErrorType.NETWORK_ERROR;
      return Promise.reject(err);
    } else {
      // Request setup error
      const err = new Error(error.message);
      err.type = PublishErrorType.UNKNOWN_ERROR;
      return Promise.reject(err);
    }
  }
}

export default new AyrshareService();
