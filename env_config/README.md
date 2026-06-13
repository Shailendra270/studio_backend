# Environment Configuration Setup

## GCP Storage Setup

The backend is configured to use Google Cloud Platform (GCP) for file storage. To enable file uploads to your GCP bucket, you need to:

### 1. Create GCP Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to IAM & Admin > Service Accounts
3. Create a new service account with the following permissions:
   - Storage Object Admin
   - Storage Legacy Bucket Reader
4. Generate and download the JSON key file

### 2. Configure Service Account

1. Copy the downloaded JSON file to this directory
2. Rename it to `gcp-service-account.json`
3. Or use the template file `gcp-service-account.json.template` and fill in your actual credentials

### 3. Verify Bucket Configuration

Ensure your GCP bucket exists and has the correct permissions:
- Bucket name: `gcp-mulistream-dev` (or update in `.env`)
- Region: `asia-south1`
- Public access: Configure based on your needs

### 4. Environment Variables

The following environment variables are configured in `.env`:
- `GCP_PROJECT_ID`: Your GCP project ID
- `GCP_BUCKET_NAME`: Your GCP storage bucket name
- `GCP_KEY_FILE`: Path to service account JSON file

## File Upload Flow

The backend supports:
1. **Presigned URL Generation**: `/api/assets/presigned-url`
2. **Direct File Upload**: Client uploads to presigned URL
3. **Asset Creation**: `/api/assets/bumpers`, `/api/assets/overlays`, `/api/assets/graphics`

## Security Notes

- Never commit `gcp-service-account.json` to version control
- The file is already added to `.gitignore`
- Use environment-specific service accounts for different deployments

## Troubleshooting

If you encounter upload issues:
1. Verify service account permissions
2. Check bucket exists and is accessible
3. Ensure CORS is configured for web uploads
4. Verify environment variables are loaded correctly