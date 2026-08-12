# ShuleAI migration rollback policy

Database migrations are the only schema mutation authority in production. Runtime HTTP requests and startup middleware must not create, alter, or repair tables.

A migration with a safe, data-preserving inverse must implement and test `down()`. A migration whose reversal could discard production data must fail explicitly from `down()` and be treated as irreversible. Recovery for an irreversible migration is either (1) restore the verified pre-migration database backup into an isolated environment and follow the rollback runbook, or (2) deploy a separately reviewed forward-fix migration.

Empty/comment-only `down()` functions are not permitted because they falsely signal rollback support. CI must run migration syntax checks, an empty-database `up` migration test, and a production-like snapshot migration test before deployment.
