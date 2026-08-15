# ShuleAI Backend Agent Rules

This repository is production ShuleAI backend code. Preserve working behavior and avoid unrelated refactors.

## Mandatory validation for code changes

Before finishing any task that changes application code:

1. Run the relevant existing tests and contract checks when available:
   - `npm test`
   - `npm run audit:routes`
   - `npm run audit:contracts`
2. If the CodeRabbit CLI is installed and authenticated, run:
   - For uncommitted work: `coderabbit review --agent --uncommitted --include-untracked`
   - For committed work: `coderabbit review --agent --committed`
3. Treat CodeRabbit `critical` and `major` findings as requiring investigation. Fix them only when the finding is valid and the fix preserves existing contracts and working behavior.
4. Do not make speculative rewrites solely to satisfy `minor`, `trivial`, stylistic, or subjective findings.
5. After any fix prompted by CodeRabbit, rerun the affected tests and run one final CodeRabbit review. Limit the review/fix loop to two repair passes unless the user explicitly requests more.
6. Never silently change API paths, HTTP methods, response shapes, authentication semantics, database relationships, payment behavior, tenant/school isolation, or realtime event contracts. Verify corresponding frontend compatibility in `ramirodaniel453-coder/shuleaione` when these areas change.

## Safety priorities

Prioritize runtime correctness, authorization, tenant isolation, data integrity, payment correctness, migration safety, realtime room authorization, API compatibility, and regression prevention over cosmetic cleanup.

If CodeRabbit is unavailable in the execution environment, do not block the task solely for that reason; complete the repository's own tests/checks and state that the automated GitHub push review remains the fallback.
