# Local development setup

Phase 1 is a backend foundation. There is no school dashboard or mobile app yet. No real SMS, payment provider or production identity provider has been provisioned.

## Installed and verified environment

- Isolated runtime: bundled Node.js 24.19.0, selected by `scripts/dev.ps1`; the existing machine-wide Node 20 installation is unchanged.
- pnpm 11.19.0, project-local dependency store and checked-in lockfile.
- PostgreSQL 18.4 binaries from `C:\Program Files\PostgreSQL\18\bin`; a separate cluster in `.local/postgres` listens only on `127.0.0.1:55432`.
- Separate `homebell` development and `homebell_test` test databases. Migrations use a local administrative connection; APIs use distinct non-superuser `hb_identity`, `hb_tenant` and `hb_control` roles.
- Redis 6.0.16 with Ubuntu security packaging, installed in the existing Ubuntu-22.04 WSL environment. The dedicated password-protected instance listens on local port 56379. This Redis instance is development/test coordination only; durable jobs have not been introduced.

The Windows setup reuses installed PostgreSQL and the existing WSL distribution. It does not install Docker or replace system Node. `PG_BIN` can override the PostgreSQL binary directory. A different machine needs Node 24.19+, pnpm 11.19, PostgreSQL 18 and Redis, or an equivalent container setup.

## Start and verify

Run from `C:\NeuXPlus\HomeBell` in PowerShell:

```powershell
./scripts/start-services.ps1
./scripts/dev.ps1 db:migrate
./scripts/dev.ps1 build
./scripts/dev.ps1 start
```

The API binds to `127.0.0.1:3000`. Health checks:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health/live
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

The first service start may require permission to run PostgreSQL/WSL outside a restricted shell. `setup:local` generates local credentials, signing material and `.env`/`.env.test` only when absent. Existing environment files are retained. Credentials are not printed. Service restarts retain the database cluster.

Stop the API with Ctrl+C. `./scripts/stop-services.ps1` stops only the configured local cluster and authenticated HomeBell Redis endpoint, without deleting data. Do not delete `.local` to solve startup issues: it contains database data and key material.

## Checks

```powershell
$env:ENV_FILE = '.env.test'
./scripts/dev.ps1 db:migrate
Remove-Item Env:ENV_FILE
./scripts/dev.ps1 build
./scripts/dev.ps1 typecheck
./scripts/dev.ps1 lint
./scripts/dev.ps1 format:check
./scripts/dev.ps1 test
./scripts/dev.ps1 test:integration
```

Tests import the compiled application, so run `build` after source changes. Integration tests require actual PostgreSQL and Redis; they do not silently skip missing services. The migration URL must point to a database whose name ends in `_test`. Each run creates synthetic records with new identifiers and a unique Redis namespace. Tests intentionally retain synthetic database records; they never reset the development database or flush shared Redis.

On a new checkout run `./scripts/dev.ps1 install --frozen-lockfile --store-dir .pnpm-store` first. pnpm may need registry access to verify its dependency policies. Use the lockfile rather than upgrading every dependency to latest.

## Identity-provider setup

`OIDC_ENABLED=false` is the default. Login endpoints return `STAFF_LOGIN_NOT_CONFIGURED`; there is no development login bypass or shared admin password. Tests run an isolated OIDC issuer and exercise actual signed tokens, authorization code exchange, PKCE, state and nonce verification.

To enable real staff login, supply `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_CALLBACK_URL` and the provider's verified `OIDC_MFA_ACR` value. Configure TLS and an exact `WEB_ORIGIN`; non-test OIDC URLs must use HTTPS. Run behind a properly configured TLS proxy. The backend does not trust forwarded headers by default, so rate limits use the direct peer until an explicitly reviewed proxy policy is added.

Register `(issuer, subject)` mappings using the administrative bootstrap command, with an identified operator and reason:

```powershell
./scripts/dev.ps1 bootstrap --issuer https://your-issuer.example --subject your-provider-subject --kind platform --operator your-operator-name --reason initial-setup
```

The command grants only the Phase 1 platform capabilities (`tenant.create`, `tenant.read`) and records a database-operator audit event. No email/domain claim grants access automatically. School provisioning additionally requires `--tenant <id> --role 'School Admin'` or `--role 'Read Only'`. It does not activate a draft tenant or grant paid access. Operational school access is tested with bounded synthetic trial fixtures; the subscription/lifecycle workflow is now implemented in Phase 2.

Web authentication uses Secure cookies plus CSRF and origin checks. An HTTP health check working does not mean browser login will work without TLS. Platform and school token audiences are enforced; the platform now has its own origin and cookie namespace; the school frontend remains a later phase.

## Secrets and local files

`.local`, `.env`, `.env.test`, keys, logs, dependency store, dependencies and build output are ignored. `.env.example` contains placeholders only. Back up local data/key material if it matters to you; ignored files are not a recovery mechanism. Do not copy local credentials to staging/production. Windows filesystem access should be limited to the developer account; POSIX file modes alone do not enforce Windows ACLs.

Only the current application signing key is accepted. Changing it invalidates outstanding access tokens; valid refresh sessions can obtain new tokens. Key-compromise recovery must also revoke the affected server sessions. Managed key rotation with overlapping verification keys remains a production integration task.

## Container/CI alternative

`compose.yaml` is an optional PostgreSQL/Redis service template; Docker is not installed or verified on this machine. It uses the same ports as the native services, so do not run both simultaneously. Supply generated `LOCAL_POSTGRES_PASSWORD` and `.local/redis-container.conf`, then provision the three runtime roles with separate random passwords before migrations. Configure the environment URLs to the new cluster; do not assume native cluster data appears in a container volume.

The CI workflow uses isolated PostgreSQL/Redis service containers and generated runtime credentials, then runs migrations/build/type/lint/format/tests. The checked-in CI password is solely for its disposable service container, never a deployed credential. There is no connected Git repository or remote CI run yet. Container images are version-tagged templates, not a verified production image-digest/deployment policy.

## Troubleshooting

## Phase 2 owner portal

Keep the existing PostgreSQL/Redis services and API. In separate PowerShell terminals:

```powershell
./scripts/dev.ps1 build
./scripts/dev.ps1 start
# Another terminal:
./scripts/start-portal.ps1
```

Open `https://localhost:3100`. The local certificate is self-signed; no OS/browser trust root has been installed. `PLATFORM_ORIGIN` defaults to that exact origin. The proxy uses `HOMEBELL_API_ORIGIN=http://127.0.0.1:3000` by default. Set these in the portal process environment when changing ports/origins; set the matching `PLATFORM_ORIGIN` in the API `.env` as well.

Workspace-local certificates were generated in `.local/localhost.key` and `.local/localhost.pem`. To regenerate them on this Windows/WSL setup (no trust-store changes):

```powershell
wsl -d Ubuntu-22.04 -u root -- openssl req -x509 -newkey rsa:2048 -nodes -keyout /mnt/c/NeuXPlus/HomeBell/.local/localhost.key -out /mnt/c/NeuXPlus/HomeBell/.local/localhost.pem -days 30 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
```

For live platform sign-in, configure the existing issuer settings plus `OIDC_PLATFORM_CALLBACK_URL=https://localhost:3100/api/v1/platform-auth/oidc/callback` in the API `.env`, register that exact redirect with the provider, and use trusted TLS as required by the provider/browser. The school callback remains separate. Restart the API after configuration changes. Do not put credentials in `NEXT_PUBLIC_*` variables or chat.

Assign an explicit platform role using an identified database operator:

```powershell
./scripts/dev.ps1 bootstrap --issuer https://your-issuer.example --subject your-provider-subject --kind platform --role 'Super Admin' --operator your-operator-name --reason initial-owner-setup
```

Other templates are `Platform Operations`, `Billing Operations`, and `Support Analyst`. Assignments are additive; existing explicit permissions remain. Without `--role`, the legacy bootstrap still grants only catalog/create capabilities. Role changes use the account lock and are audited. The command creates no password/session and never grants school membership implicitly.

Phase 2 checks:

```powershell
./scripts/dev.ps1 build
./scripts/dev.ps1 typecheck
./scripts/dev.ps1 build:web
./scripts/dev.ps1 typecheck:web
./scripts/dev.ps1 lint
./scripts/dev.ps1 format:check
./scripts/dev.ps1 test
./scripts/dev.ps1 test:integration
./scripts/dev.ps1 test:browser
./scripts/dev.ps1 usage:reconcile
```

Install Chromium once with `pnpm exec playwright install chromium`. The browser suite uses a dedicated signed issuer, the `_test` database, port 3101 and an isolated context accepting only the local test certificate. Stop the development portal before browser tests/builds so Next processes do not contend for development output. The downloaded headless shell is the verified Windows browser; the full Chrome executable had a local side-by-side startup error.

Before upgrading an existing Phase 1 database, stop the old API, run `node scripts/preflight-phase2.mjs`, then migrations and `node scripts/reconcile-usage.mjs` under Node 24. Use `ENV_FILE=.env.test` for the dedicated test database. No script resets data. Never run Phase 1 as a rollback after Phase 2 access enforcement is enabled.

## Common failures

- `SESSION_INVALID` / `MFA_REQUIRED`: check actual issuer mapping, server session state and the issuer-specific assurance value; do not weaken checks.
- Database `42501`: confirm runtime grants and transaction tenant context. Do not switch the API to the migration/superuser connection.
- `COORDINATION_UNAVAILABLE`: start Redis and verify the URL/password; limits fail closed.
- WSL reports NAT fallback: this machine can use its fallback network mode; validate connectivity with `node scripts/check-services.mjs` through the development wrapper.
- Migration failure: inspect the failed migration and use a reviewed forward repair. Do not edit previously applied migration logic or run destructive resets against an existing database.

