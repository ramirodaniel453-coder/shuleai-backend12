# Durable Upload Storage Setup

This build keeps new user-facing uploads from depending on Render local disk.

## Recommended: Cloudinary
Set these in Render:

```txt
FILE_STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_FOLDER=shuleai
```

Optional strict mode:

```txt
REQUIRE_OBJECT_STORAGE=true
```

When Cloudinary is configured, new school logos, profile photos, signatures, homework files and chat attachments are saved to Cloudinary and the database stores the public durable URL.

## Fallback: database-backed storage
Without Cloudinary, ShuleAI stores uploaded assets in the `MediaAssets` table. This is persistent across Render redeploys, unlike `/uploads`, but large files can grow the database. Cloudinary is better for rollout.

## Legacy local files
Old `/uploads/...` links may still work until Render deletes local disk. Re-upload important logos/signatures/photos after deployment so they become durable.
