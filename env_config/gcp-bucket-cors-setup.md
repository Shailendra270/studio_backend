# GCP Bucket CORS Configuration

For direct file uploads from the frontend to your GCP bucket, you need to configure CORS (Cross-Origin Resource Sharing) on your bucket.

## Setup CORS for GCP Bucket

### Method 1: Using Google Cloud Console

1. Go to [Google Cloud Storage](https://console.cloud.google.com/storage)
2. Select your bucket: `gcp-mulistream-dev`
3. Go to the "Permissions" tab
4. Click "Edit CORS configuration"
5. Add the following CORS configuration:

```json
[
  {
    "origin": [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://zentag.ai",
      "https://zentag-frontend.vercel.app"
    ],
    "method": ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Methods",
      "Access-Control-Allow-Headers",
      "Access-Control-Max-Age",
      "Access-Control-Allow-Credentials",
      "x-goog-resumable"
    ],
    "maxAgeSeconds": 3600
  }
]
```

### Method 2: Using gsutil Command Line

1. Create a file named `cors.json` with the above configuration
2. Run the following command:

```bash
gsutil cors set cors.json gs://gcp-mulistream-dev
```

### Method 3: Using gcloud CLI

```bash
gcloud storage buckets update gs://gcp-mulistream-dev --cors-file=cors.json
```

## Verify CORS Configuration

To verify your CORS configuration:

```bash
gsutil cors get gs://gcp-mulistream-dev
```

## Important Notes

- Replace `gcp-mulistream-dev` with your actual bucket name if different
- Add your production domain to the `origin` array
- The `x-goog-resumable` header is important for large file uploads
- CORS changes may take a few minutes to propagate

## Troubleshooting

If uploads still fail:
1. Check browser developer tools for CORS errors
2. Verify the bucket name matches your environment configuration
3. Ensure the service account has proper permissions
4. Test with a simple curl command first

## Testing CORS

You can test CORS with curl:

```bash
curl -H "Origin: http://localhost:5173" \
     -H "Access-Control-Request-Method: PUT" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://storage.googleapis.com/gcp-mulistream-dev/test
```