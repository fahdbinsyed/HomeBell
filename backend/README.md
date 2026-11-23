# HomeBell backend (.NET 10)

Modular monolith: `src/Host/HomeBell.Api` (+ `HomeBell.Worker`), modules under `src/Modules/*`, shared code in
`src/BuildingBlocks`. Conventions: [ADR-0019](../docs/adr/0019-backend-implementation-conventions.md).

## Run locally

Prerequisites: .NET SDK 10.0.401, Docker Desktop running.

```powershell
docker compose -f infra/docker-compose.yml up -d     # PostgreSQL :5433, Redis :6379, Mailpit :8025
dotnet run --project backend/src/Host/HomeBell.Api    # http://localhost:5080 (Development)
```

In Development the API applies migrations and seeds demo data on startup (`appsettings.Development.json`).
To only migrate: `dotnet run --project backend/src/Host/HomeBell.Api -- --migrate`.

### Demo accounts (test values only)

| Who                     | Sign-in                                  | Notes                                                                    |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Platform owner          | `owner@homebell.test` / `demo1234`       | TOTP required: add secret `JBSWY3DPEHPK3PXP` to an authenticator app     |
| Greenfield school admin | `admin@greenfield.test` / `demo1234`     | Also admin at Riverside                                                  |
| Greenfield dispatcher   | `dispatch@greenfield.test` / `demo1234`  |                                                                          |
| Guardian                | phone `+15550100001`, code `000000`      | Send `X-Device-Id: <uuid>`; activates profiles at Greenfield + Riverside |
| Blocked guardian        | phone `+15550100003`                     | Blocked at Greenfield                                                    |

OTP "SMS" and password-reset emails arrive in Mailpit: <http://localhost:8025>.

### Logs

`backend/src/Host/HomeBell.Api/Logs/HomeBell.Api.log` (application) and `HomeBell.Api.audit.log`
(audit trail), format `yyyy-MM-dd HH:mm:ss,fff - LEVEL - UniqueId - PlainText - SensitiveData`.

```csharp
LogHelper.WriteLine(AppLogLevel.Info, requestId, "OTP sent", sensitiveData); // sensitive data is masked
LogHelper.AuditUserAction(requestId, "admin blocked guardian ...");
```

## Test

```powershell
dotnet test --solution backend/HomeBell.slnx
```

Integration tests start throwaway PostgreSQL and Redis containers (Docker required), run the migrator as the
owner, call the API as the restricted `homebell_app` role, and validate **every response** against
`packages/contracts/bundled/openapi.v1.yaml`.

## Migrations

```powershell
cd backend
dotnet tool restore
dotnet ef migrations add <Name> --project src/Modules/<M>/HomeBell.Modules.<M>.Infrastructure --startup-project src/Modules/<M>/HomeBell.Modules.<M>.Infrastructure --output-dir Migrations
```

Tenant-owned tables must call `migrationBuilder.EnableTenantRls("<schema>", "<table>")` in the migration.
