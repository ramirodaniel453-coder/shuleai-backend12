# Backup and Restore Runbook

## Required automated verification target

Set `BACKUP_VERIFY_DATABASE_URL` to a dedicated disposable PostgreSQL database and set `BACKUP_VERIFY_DATABASE_NAME` to the exact database name in that URL. The name must clearly contain both `backup` or `restore` and `verify` or `verification` (for example `shuleai_backup_verify`). It must never be the production, `postgres`, or a template database.

Every queued platform backup remains failed—not completed—unless all four gates succeed: custom-format dump creation, streaming SHA-256, `pg_restore --list`, and a real single-transaction restore into that dedicated verification database followed by a public-table check.

## Before live schools
1. Confirm Render Postgres backup retention.
2. Export a manual backup before first school onboarding.
3. Restore that backup into a temporary database.
4. Point a staging backend to the restored database.
5. Verify login, students, fees, reports and uploads.

## Minimum restore test
- Admin can log in.
- A teacher can see students/classes.
- A parent can see only their child.
- Report history opens.
- Media assets open through `/api/media/:token` or Cloudinary URLs.

## Operational rule
A backup is not proven until a restore has been tested.
