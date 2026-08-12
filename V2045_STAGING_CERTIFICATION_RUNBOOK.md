# v2045 Staging Certification Runbook

This runbook is mandatory before production. Use only a protected staging clone restored from a verified backup. Do not point these commands at production and do not run seed scripts.

## 1. Backup and identity gate

1. Freeze application writes on staging.
2. Record the release archive SHA-256 and Git commit, if the artifact is committed.
3. Create a real custom-format PostgreSQL backup and checksum.
4. Restore that backup to a separate verification database and run `pg_restore --list` plus a read-only count comparison.

Example environment-safe commands:

```bash
test "${NODE_ENV:-}" != production
test -n "${DATABASE_URL:-}"
backup_file="$(mktemp -d)/shuleai-v2045-staging.dump"
pg_dump --format=custom --no-owner --no-acl --file="$backup_file" "$DATABASE_URL"
sha256sum "$backup_file"
pg_restore --list "$backup_file" >/dev/null
```

The release operator must preserve the backup outside the ephemeral deployment filesystem before continuing.

## 2. Database migration gates

Run all migrations through the normal migration runner. Never use `sync({force:true})`, runtime repair endpoints, or production seeds.

```bash
npm ci
npm test
npm run audit:routes
npm run audit:contracts
npm run migrate
npm run certify:v2045:db
```

Required evidence:

- `MigrationIntegrityChecks.status = verified` for `20260811000000-v2045-country-curriculum-academic-lock`.
- `countsBefore` exactly equals `countsAfter` for every protected table.
- `mismatchTables` is empty.
- The legacy academic digest did not change.
- Every school has Kenya, an active pack, and exactly one active assignment after the backfill.
- No student, class membership, parent link, enrollment, invoice, payment, or academic record was deleted.

Execute the same migration chain against:

1. a blank database;
2. a fresh clone of the protected database;
3. a data-heavy staging database with concurrent writes disabled.

## 3. Official curriculum review gate

For each country, call the admin country/pack endpoints and confirm that only that country's active reviewed packs are returned. Pending/inactive shells must never appear as selectable.

Before activating a new national pack version, two humans must review:

- curriculum authority and official publication URL;
- effective date and version/code;
- stage/level hierarchy;
- required and optional subject structures;
- assessment types and grading profiles;
- class names, stream constraints, and pathways;
- source checksum and reviewer identity.

No generated or assumed content may pass this gate.

## 4. Academic workflow matrix

For each approved active pack in staging:

1. Change one test school's curriculum through the canonical admin workflow.
2. Confirm a new `SchoolCurriculumAssignment` version and audit log are created.
3. Confirm the previous assignment is superseded, not deleted.
4. Confirm existing students/classes/enrollments and historical `AcademicRecords` are byte-equivalent to the pre-change snapshot.
5. Create a new assessment and verify its curriculum/grading snapshots reference the new assignment/pack version.
6. Change the school's active pack again and verify the existing assessment grade and report card do not change.
7. Compare the same assessment in teacher, parent, student, report-card, and analytics views; grade, descriptor, and points must match.
8. Submit a teacher payload containing `gradingScale`; expect `TEACHER_GRADING_SCALE_FORBIDDEN`.
9. Submit an attempted student curriculum override; confirm it is ignored/rejected and server resolution wins.

## 5. Class generation matrix

Run preview and confirm for each mode:

| Mode | Input | Expected result |
|---|---|---|
| No streams | Enabled levels only | One missing class per level |
| Global | `East`, `West` | Missing `level + stream` combinations only |
| Per-level | Different lists by level | Only configured combinations; unconfigured level remains unstreamed |
| Custom | Valid custom names mapped to pack level codes | Exact missing custom names only |

For every mode:

- record class, student, and enrollment counts before preview;
- preview twice and confirm deterministic output;
- mutate the assignment after preview and verify the old token fails as stale;
- confirm once, then replay the same confirmation and verify no duplicate class;
- verify archived/existing classes remain untouched;
- verify every learner's class/enrollment IDs are unchanged.

## 6. Payment completion matrix

Use provider sandbox/test tenants tied to the staging school and the backend-selected single active provider. Capture request ID, provider event ID, expected amount/currency/school, HTTP result, payment state, `PaymentEvent`, completion authority/evidence, audit row, and subscription state.

| Scenario | Expected payment result | Subscription result |
|---|---|---|
| M-Pesa STK verified success callback | Completed once with callback certification | Activate once |
| M-Pesa STK confirmed by status query | Completed once with query certification | Activate once |
| Manual M-Pesa authorized review | Completed with manual-review certification | Activate once if linked |
| Bank transfer authorized review | Completed with manual-review certification | Activate once if linked |
| PesaPal verified IPN/status | Completed once after provider query | Activate once |
| Duplicate callback | Accepted idempotently; no second mutation | No second activation |
| Replayed callback/event ID | Rejected or idempotent according to provider signature/event semantics | No activation change |
| Incorrect amount | Manual-review hold; never completed | Inactive |
| Missing amount | Manual-review hold; never completed | Inactive |
| Wrong currency | Manual-review hold; never completed | Inactive |
| Incorrect school reference | Rejected after callback authentication | Inactive |
| Wrong-provider callback | Rejected after callback authentication | Inactive |
| Delayed paid response after expiry | Manual-review hold | Inactive |
| Provider pending | Pending | Inactive |
| Provider failure/abandonment | Failed/abandoned | Inactive |
| Unauthorized manual approval | 403 | Inactive |
| Authorized manual approval | One transactional completion + audit | Activate once |

Also confirm the browser never sends `status=completed`, cannot choose the active provider, and cannot supply a trusted amount/school identity for callback finalization.

## 7. Role, refresh, and restart matrix

Run browser smoke tests as Super Admin, Admin, Finance, Teacher, Parent, Student, and LearnFeed. Verify authorization failures for cross-role/cross-school requests.

Then:

1. refresh every active academic/payment page;
2. restart the backend and worker;
3. reconnect Socket.IO;
4. repeat curriculum resolution, assessment display, class preview, payment status, and subscription access checks;
5. verify no state depended on browser memory or process-local state.

## 8. Approval record

Production deployment is blocked until the release record contains:

- exact artifact SHA-256 and commit;
- backup checksum and restore-verification evidence;
- blank/clone/data-heavy migration results;
- protected before/after counts and history digest;
- all role path results;
- provider scenario evidence;
- official curriculum review approvals for every pack activated;
- named staging approver, timestamp, and explicit decision.

