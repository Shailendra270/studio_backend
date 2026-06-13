import PublishEvent from '../../models/PublishEvent.js';
import { PublishErrorType } from '../../config/platform.rules.js';

class WebhookHandler {
  /**
   * Process incoming webhook from Ayrshare
   * @param {Object} payload - Webhook payload
   * @returns {Promise<void>}
   */
  async handle(payload) {
    const { refId, id, status, postIds, errors } = payload;
    
    // Find the event
    // refId is what we get back from Ayrshare when posting?
    // Ayrshare documentation says `refId` is unique per post attempt.
    
    try {
      const event = await PublishEvent.findOne({ ayrshareRefId: refId });
      
      if (!event) {
        console.warn(`Webhook received for unknown refId: ${refId}`);
        return; // Or create a new record if desired
      }

      if (status === 'success' || status === 'published') {
        event.status = 'completed';
        event.postUrl = postIds?.[0]?.postUrl || event.postUrl;
        event.platformPostId = postIds?.[0]?.id || id;
        event.publishedAt = new Date();
      } else if (status === 'error' || status === 'failed') {
        event.status = 'failed';
        event.errorMessage = errors?.[0]?.message || 'Unknown error from webhook';
        event.ayrshareResponse = payload;
      }
      
      await event.save();
      console.log(`Processed webhook for event ${event._id}: ${status}`);

    } catch (error) {
      console.error('Webhook processing error:', error);
      throw error;
    }
  }
}

export default new WebhookHandler();
