# ShuleAI v2044 Staging-First Rollout Runbook

Schema changes are permitted only through an explicit, separately invoked `npm run migrate` release step. The API server and worker never run migrations, call `sequelize.sync()`, or perform request-time schema repair.

## Required deployment order

1. Back up the staging PostgreSQL database, calculate the archive checksum, and verify the backup by restoring it into a dedicated verification database.
2. Deploy the backend and worker artifacts without directing user traffic to the new release.
3. Run `npm run migrate` as an explicit release operation against staging. Capture the migration log and integrity-count evidence.
4. Run syntax, model, route, API-contract, migration-integrity, security, dependency, and critical-flow tests. Compare protected entity counts before and after migration.
5. Deploy the frontend with a new cache/build identifier and verify the generated service-worker precache manifest.
6. Live-test Super Admin, Admin, Finance, Teacher, Parent, Student, and LearnFeed roles with the old service-worker cache bypassed.
7. Exercise provider sandbox webhooks and callbacks for M-Pesa STK, manual M-Pesa, bank transfer, and PesaPal, including duplicate, wrong-amount, wrong-school, and failure cases.
8. Attach the evidence to the release record and obtain explicit founder/release-owner approval for the exact commit and migration set.
9. After approval, repeat the verified backup and explicit migration procedure in production, then deploy the approved artifacts. Never seed, reset, force-sync, or delete quarantined data.
10. Run production health, authorization, tenancy, role-dashboard, payment, cache, backup, and restart smoke tests. Keep the verified pre-deployment backup as the rollback point.

## Required environment and health checks

- `/health/ready` reports the real database readiness state.
- `/api/health/detailed` reports real database, storage, cache, monitoring, and system-load state; failures are not rewritten as authentication errors.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` are distinct production values of at least 32 characters.
- `CORS_ALLOWED_ORIGINS` contains the exact origins accepted by both HTTP and Socket.IO.
- Storage is durable (`cloudinary` or database storage), and Redis is configured before scaling to multiple instances.
- Maintenance and registration behavior comes from the persistent platform-settings record and is enforced server-side.

## Migration failure and rollback policy

- Stop the release immediately if migrations, protected-count comparisons, foreign-key checks, or smoke tests fail.
- Preserve invalid or orphaned rows in the quarantine ledger; never delete them to make a migration pass.
- Correct data through an audited forward-repair migration. Do not run ad-hoc SQL or a runtime repair script.
- If an application rollback is required, restore the previously approved application artifact. Restore the verified database backup only after explicit approval and only when a forward repair cannot safely recover the release.
- Do not validate a `NOT VALID` foreign key until its quarantine set has been resolved and the validation succeeds on staging.
