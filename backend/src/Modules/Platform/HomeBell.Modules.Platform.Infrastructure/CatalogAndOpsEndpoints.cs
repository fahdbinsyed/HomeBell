using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Platform.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using P = HomeBell.BuildingBlocks.Domain.Contract.Permission;

namespace HomeBell.Modules.Platform.Infrastructure;

internal static partial class CatalogEndpoints
{
    [GeneratedRegex("^[a-z0-9_]{2,40}$")]
    private static partial Regex PlanCode();

    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var g = endpoints.MapGroup("/v1/platform");

        g.MapGet("/plans", async (PlatformDbContext db, CancellationToken ct) =>
        {
            var plans = await db.Plans.AsNoTracking().OrderBy(p => p.Name).ToListAsync(ct);
            var versions = await db.PlanVersions.AsNoTracking().ToListAsync(ct);
            return new ItemsDto<SubscriptionPlanDto>(plans.Select(p => ToDto(p, versions)).ToList());
        }).RequirePlatformPermission(P.PlatformPlansRead);

        g.MapPost("/plans", async (CreatePlanRequest b, PlatformSupport s, CancellationToken ct) =>
        {
            new Validator()
                .Required("code", b.Code).Pattern("code", b.Code, PlanCode(), "2–40 lowercase letters, digits or underscores.")
                .Required("name", b.Name).MaxLength("name", b.Name, 100).MaxLength("description", b.Description, 1000)
                .Required("isPublic", b.IsPublic)
                .ThrowIfInvalid();
            if (await s.Db.Plans.AnyAsync(p => p.Code == b.Code, ct))
            {
                throw Problem.Of(ErrorCodes.Conflict, "Plan code already exists.");
            }

            var plan = new SubscriptionPlan(Guid.CreateVersion7(), b.Code!, b.Name!, b.Description, b.IsPublic!.Value, s.Now);
            s.Db.Plans.Add(plan);
            await s.Db.SaveChangesAsync(ct);
            return Results.Json(ToDto(plan, []), JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(P.PlatformPlansWrite);

        g.MapGet("/plans/{planId:guid}", async (Guid planId, PlatformDbContext db, CancellationToken ct) =>
        {
            var plan = await db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == planId, ct) ?? throw Problem.NotFound();
            return ToDto(plan, await db.PlanVersions.AsNoTracking().Where(v => v.PlanId == planId).ToListAsync(ct));
        }).RequirePlatformPermission(P.PlatformPlansRead);

        g.MapPost("/plans/{planId:guid}/versions", async (Guid planId, CreatePlanVersionRequest b, PlatformSupport s, CancellationToken ct) =>
        {
            new Validator()
                .Required("price", b.Price).Required("price.amountMinor", b.Price?.AmountMinor)
                .Must(b.Price?.AmountMinor is null or >= 0, "price.amountMinor", "invalid_value", "Price cannot be negative.")
                .OneOf("price.currency", b.Price?.Currency, Currency.All)
                .Required("features", b.Features).Required("limits", b.Limits)
                .ThrowIfInvalid();
            var badFeatures = b.Features!.Keys.Where(k => !FeatureKey.IsValid(k)).ToList();
            var badLimits = b.Limits!.Where(kv => !LimitKey.IsValid(kv.Key) || kv.Value < 0).Select(kv => kv.Key).ToList();
            new Validator()
                .Must(badFeatures.Count == 0, "features", "invalid_value", $"Unknown feature keys: {string.Join(", ", badFeatures)}.")
                .Must(badLimits.Count == 0, "limits", "invalid_value", $"Unknown limit keys or negative values: {string.Join(", ", badLimits)}.")
                .ThrowIfInvalid();
            var plan = await s.Db.Plans.FirstOrDefaultAsync(p => p.Id == planId, ct) ?? throw Problem.NotFound();
            var next = (await s.Db.PlanVersions.Where(v => v.PlanId == planId).MaxAsync(v => (int?)v.Version, ct) ?? 0) + 1;
            var v = new PlanVersion(Guid.CreateVersion7(), planId, next, b.Price!.AmountMinor!.Value, b.Features!, b.Limits!, s.Now);
            s.Db.PlanVersions.Add(v);
            await s.Db.SaveChangesAsync(ct);
            return Results.Json(PlatformSupport.VersionDto(v, plan.Name), JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(P.PlatformPlansWrite);

        g.MapPost("/plans/{planId:guid}/versions/{versionId:guid}/publish", async (Guid planId, Guid versionId, PlatformSupport s, IAuditWriter audit, CancellationToken ct) =>
        {
            var v = await s.Db.PlanVersions.FirstOrDefaultAsync(x => x.Id == versionId && x.PlanId == planId, ct) ?? throw Problem.NotFound();
            if (v.Status != PlanVersionStatus.Draft)
            {
                throw Problem.Of(ErrorCodes.Conflict, "Only draft versions can be published.");
            }

            v.Publish(s.Now);
            audit.Write(new AuditEntry(AuditAction.PlanVersionPublished, AuditOutcome.Success, "plan_version", v.Id.ToString(),
                Data: new Dictionary<string, object?> { ["planId"] = planId, ["version"] = v.Version }));
            await s.Db.SaveChangesAsync(ct);
            return await s.VersionDtoAsync(v, ct);
        }).RequirePlatformPermission(P.PlatformPlansWrite);

        g.MapPost("/plans/{planId:guid}/versions/{versionId:guid}/retire", async (Guid planId, Guid versionId, PlatformSupport s, CancellationToken ct) =>
        {
            var v = await s.Db.PlanVersions.FirstOrDefaultAsync(x => x.Id == versionId && x.PlanId == planId, ct) ?? throw Problem.NotFound();
            if (v.Status != PlanVersionStatus.Published)
            {
                throw Problem.Of(ErrorCodes.Conflict, "Only published versions can be retired.");
            }

            v.Retire();
            await s.Db.SaveChangesAsync(ct);
            return await s.VersionDtoAsync(v, ct);
        }).RequirePlatformPermission(P.PlatformPlansWrite);

        g.MapGet("/feature-flags", async (PlatformDbContext db, CancellationToken ct) =>
            new ItemsDto<FeatureFlagDto>((await db.FeatureFlags.AsNoTracking().OrderBy(f => f.Key).ToListAsync(ct)).Select(ToDto).ToList()))
            .RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapPut("/feature-flags/{flagKey}", async (string flagKey, UpdateFeatureFlagRequest b, PlatformSupport s, IAuditWriter audit, CancellationToken ct) =>
        {
            new Validator()
                .Required("enabledByDefault", b.EnabledByDefault).Required("tenantAllowList", b.TenantAllowList).Required("tenantDenyList", b.TenantDenyList)
                .Required("note", b.Note).MaxLength("note", b.Note, 2000)
                .ThrowIfInvalid();
            var flag = await s.Db.FeatureFlags.FirstOrDefaultAsync(f => f.Key == flagKey, ct) ?? throw Problem.NotFound();
            flag.Update(b.EnabledByDefault!.Value, b.TenantAllowList!.Distinct().ToList(), b.TenantDenyList!.Distinct().ToList(), s.Now);
            audit.Write(new AuditEntry(AuditAction.FlagUpdated, AuditOutcome.Success, "feature_flag", flagKey,
                Data: new Dictionary<string, object?> { ["enabledByDefault"] = b.EnabledByDefault, ["allow"] = b.TenantAllowList!.Count, ["deny"] = b.TenantDenyList!.Count, ["note"] = b.Note }));
            await s.Db.SaveChangesAsync(ct);
            return ToDto(flag);
        }).RequirePlatformPermission(P.PlatformFlagsWrite);
    }

    private static SubscriptionPlanDto ToDto(SubscriptionPlan p, IReadOnlyList<PlanVersion> versions) =>
        new(p.Id, p.Code, p.Name, p.Description, p.IsPublic,
            versions.Where(v => v.PlanId == p.Id).OrderBy(v => v.Version).Select(v => PlatformSupport.VersionDto(v, p.Name)).ToList());

    private static FeatureFlagDto ToDto(FeatureFlag f) => new(f.Key, f.Description, f.EnabledByDefault, f.TenantAllowList, f.TenantDenyList, f.UpdatedAt);
}

internal static class OpsEndpoints
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var g = endpoints.MapGroup("/v1/platform");

        g.MapGet("/audit-logs", async (Guid? tenantId, string? action, Guid? actorId, string? outcome, DateTimeOffset? from, DateTimeOffset? to, string? format, int? limit, string? cursor,
            PlatformDbContext db, ITenantDirectory tenants, CancellationToken ct) =>
        {
            new Validator().OneOf("outcome", outcome, AuditOutcome.All).OneOf("format", format, ["json", "csv"]).ThrowIfInvalid();
            var query = db.AuditLog.AsNoTracking()
                .Where(a => tenantId == null || a.TenantId == tenantId)
                .Where(a => action == null || a.Action == action)
                .Where(a => actorId == null || a.ActorId == actorId)
                .Where(a => outcome == null || a.Outcome == outcome)
                .Where(a => from == null || a.OccurredAt >= from)
                .Where(a => to == null || a.OccurredAt < to)
                .OrderByDescending(a => a.OccurredAt).ThenByDescending(a => a.Id);
            var take = format == "csv" ? 10_000 : Paging.Limit(limit);
            var skip = format == "csv" ? 0 : Paging.Offset(cursor);
            var rows = await query.Skip(skip).Take(take + 1).ToListAsync(ct);
            var names = await tenants.GetManyAsync(rows.Where(r => r.TenantId is not null).Select(r => r.TenantId!.Value).Distinct().ToList(), ct);
            var items = rows.Take(take).Select(r => AuditDto(r, r.TenantId is { } t && names.TryGetValue(t, out var info) ? info.Name : null)).ToList();
            return format == "csv" ? Csv(items) : Results.Json(new Page<AuditLogEntryDto>(items, Paging.Next(skip, take, rows.Count), take), JsonDefaults.Options);
        }).RequirePlatformPermission(P.PlatformAuditRead);

        g.MapGet("/support-sessions", async (Guid? tenantId, int? limit, string? cursor, PlatformDbContext db, CancellationToken ct) =>
        {
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var rows = await db.SupportSessions.AsNoTracking().Where(x => tenantId == null || x.TenantId == tenantId)
                .OrderByDescending(x => x.StartedAt).Skip(skip).Take(take + 1).ToListAsync(ct);
            var ids = rows.Select(r => r.TenantId).Distinct().ToList();
            var names = await db.Tenants.AsNoTracking().Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, ct);
            return new Page<SupportSessionDto>(rows.Take(take).Select(r => ToDto(r, names.GetValueOrDefault(r.TenantId, "?"))).ToList(), Paging.Next(skip, take, rows.Count), take);
        }).RequirePlatformPermission(P.PlatformSupportSessionsCreate);

        g.MapPost("/support-sessions", async (CreateSupportSessionRequest b, PlatformSupport s, ISessionIssuer sessions, ICurrentActor actor, IAuditWriter audit, IUnitOfWork uow, CancellationToken ct) =>
        {
            new Validator()
                .Required("tenantId", b.TenantId)
                .Required("reason", b.Reason).MinLength("reason", b.Reason?.Trim(), 10).MaxLength("reason", b.Reason, 1000)
                .Required("durationMinutes", b.DurationMinutes).Must(b.DurationMinutes is null or (>= 5 and <= 30), "durationMinutes", "invalid_value", "5–30 minutes.")
                .ThrowIfInvalid();
            var created = await uow.ExecuteAsync(async t =>
            {
                var tenant = await s.TenantAsync(b.TenantId!.Value, t);
                var tokens = await sessions.IssueSupportSessionAsync(actor.Id!.Value, tenant.Id, b.DurationMinutes!.Value, t);
                var session = new SupportSession(Guid.CreateVersion7(), tenant.Id, actor.Id.Value, actor.DisplayName, b.Reason!.Trim(), tokens.SessionId, s.Now, s.Now.AddMinutes(b.DurationMinutes.Value));
                s.Db.SupportSessions.Add(session);
                audit.Write(new AuditEntry(AuditAction.SupportSessionStarted, AuditOutcome.Success, "support_session", session.Id.ToString(),
                    Data: new Dictionary<string, object?> { ["reason"] = session.Reason, ["minutes"] = b.DurationMinutes }, TenantId: tenant.Id));
                await s.Db.SaveChangesAsync(t);
                var dto = ToDto(session, tenant.Name);
                return new SupportSessionCreatedDto(dto.Id, dto.TenantId, dto.TenantName, dto.Reason, dto.PlatformUser, dto.StartedAt, dto.ExpiresAt, dto.EndedAt,
                    new TokenPairDto(tokens.AccessToken, tokens.AccessTokenExpiresAt, tokens.RefreshToken, tokens.RefreshTokenExpiresAt, tokens.SessionId, tokens.Scope));
            }, ct);
            return Results.Json(created, JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(P.PlatformSupportSessionsCreate);

        g.MapPost("/support-sessions/{sessionId:guid}/end", async (Guid sessionId, PlatformSupport s, ISessionIssuer sessions, IAuditWriter audit, CancellationToken ct) =>
        {
            var session = await s.Db.SupportSessions.FirstOrDefaultAsync(x => x.Id == sessionId, ct) ?? throw Problem.NotFound();
            if (session.EndedAt is null)
            {
                session.End(s.Now);
                audit.Write(new AuditEntry(AuditAction.SupportSessionEnded, AuditOutcome.Success, "support_session", session.Id.ToString(), TenantId: session.TenantId));
                await s.Db.SaveChangesAsync(ct);
                await sessions.RevokeSessionAsync(session.IdentitySessionId, ct);
            }

            var name = await s.Db.Tenants.AsNoTracking().Where(t => t.Id == session.TenantId).Select(t => t.Name).FirstAsync(ct);
            return ToDto(session, name);
        }).RequirePlatformPermission(P.PlatformSupportSessionsCreate);
    }

    internal static AuditLogEntryDto AuditDto(AuditLogRecord r, string? tenantName) =>
        new(r.Id, r.OccurredAt, r.TenantId, tenantName, r.Action, r.Outcome,
            new ActorRefDto(r.ActorType, r.ActorId, r.ActorDisplay), null,
            r.TargetType, r.TargetId, null, r.ReasonCode, r.RequestId, r.DeviceId,
            JsonDocument.Parse(string.IsNullOrEmpty(r.Data) ? "{}" : r.Data).RootElement.Clone());

    private static IResult Csv(IReadOnlyList<AuditLogEntryDto> items)
    {
        static string Esc(string? v) => v is null ? string.Empty : v.Contains(',') || v.Contains('"') || v.Contains('\n') ? $"\"{v.Replace("\"", "\"\"", StringComparison.Ordinal)}\"" : v;
        var sb = new StringBuilder("occurredAt,tenant,action,outcome,actor,targetType,targetId,reasonCode\n");
        foreach (var i in items)
        {
            sb.Append(CultureInfo.InvariantCulture, $"{UtcTimestampConverter.Format(i.OccurredAt)},{Esc(i.TenantName)},{Esc(i.Action)},{Esc(i.Outcome)},{Esc(i.Actor.DisplayName)},{Esc(i.TargetType)},{Esc(i.TargetId)},{Esc(i.ReasonCode)}\n");
        }

        return Results.Text(sb.ToString(), "text/csv", Encoding.UTF8);
    }

    private static SupportSessionDto ToDto(SupportSession s, string tenantName) =>
        new(s.Id, s.TenantId, tenantName, s.Reason, new ActorRefDto(AuditActorType.User, s.PlatformUserId, s.PlatformUserName), s.StartedAt, s.ExpiresAt, s.EndedAt);
}
