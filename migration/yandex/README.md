# Yandex Cloud migration PoC for easy

This is an isolated proof of concept. It does not change the production app, Firebase project, or live data.

## First-stage plan

1. Create a separate Yandex Cloud folder and a **Serverless YDB** test database.
2. Create `app_records` and `migration_batches` using `schema.sql`.
3. Convert a local Firebase export to NDJSON with `scripts/backup-to-ndjson.mjs`.
4. Import only into the test database; compare record counts and selected business totals against the source export.
5. Build an authenticated API and a sync-event mechanism after measuring actual access patterns and Request Units.
6. Point a separate test build of the app at the PoC API. Keep production on Firebase until acceptance tests pass.

## Security requirements

- Never commit Firebase exports, converted NDJSON, `.env` files, service-account keys, passwords, or tokens.
- The current app contains legacy password handling and hard-coded administrator credentials. Do not migrate those values. The converter recursively removes password/secret/token-like fields and marks user records as requiring a password reset.
- Rotate exposed credentials and remove the committed Firebase export from the repository. Removing it in a new commit does not purge it from Git history; history cleanup is a separate operation.
- Never use production credentials in the test environment.

## Local conversion (no network access)

```bash
node migration/yandex/scripts/backup-to-ndjson.mjs \
  /path/to/firebase-export.json \
  migration-data/yandex/records.ndjson
```

The output is created with owner-only file permissions. Keep it outside Git and delete it after the test import is verified.

## Not implemented yet

- No Yandex Cloud resources are created by this repository change.
- No data is uploaded anywhere.
- No API, authentication, realtime/polling transport, or production cutover is implemented.
- `app_records` is a loss-minimizing staging table, not the final optimized schema. Query-heavy collections will be normalized after the PoC identifies actual access patterns.

## Acceptance checks

- Imported record counts match source counts for every collection (excluding intentionally redacted credential fields).
- Totals for sales, expenses, stock movements, stock products, salary ledger, and audit events match the source.
- CRUD tests pass for sales, expenses, stock, salary, tasks, users, and audit log.
- Two browser sessions see each other's changes within the agreed sync interval.
- Offline writes survive reload/reconnect and do not duplicate.
- Role/store/org permissions are enforced server-side, not only in browser code.
- The monthly cost dashboard shows no unexpected paid usage before any production decision.
