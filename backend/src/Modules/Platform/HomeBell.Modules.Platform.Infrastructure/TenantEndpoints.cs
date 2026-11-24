using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Guardians.Contracts;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Platform.Domain;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using P = HomeBell.BuildingBlocks.Domain.Contract.Permission;

namespace HomeBell.Modules.Platform.Infrastructure;

/// <summary>Shared helpers for platform handlers.</summary>
internal sealed partial class PlatformSupport(
    PlatformDbContext db,
    ISchoolStats schools,
    IGuardianStats guardians,
    ICurrentActor actor,
    IClock clock)
{
    public PlatformDbContext Db => db;

    public DateTimeOffset Now => clock.UtcNow;

    public ActorStamp Me => new(AuditActorType.User, actor.Id, actor.DisplayName);

    public bool Can(string permission) => RolePermissions.ForPlatformRoles(actor.PlatformRoles).Contains(permission, StringComparer.Ordinal);

    public async Task<Tenant> TenantAsync(Guid id, CancellationToken ct) =>
        await db.Tenants.FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw Problem.NotFound();

    public async Task<PlanVersionDto> VersionDtoAsync(PlanVersion v, CancellationToken ct)
    {
        var plan = await db.Plans.AsNoTracking().FirstAsync(p => p.Id == v.PlanId, ct);
        return VersionDto(v, plan.Name);
    }

    public static PlanVersionDto VersionDto(PlanVersion v, string planName) =>
        new(v.Id, v.PlanId, planName, v.Version, v.Status, new MoneyDto(v.PriceMinor, v.Currency), v.BillingPeriod, v.Features, v.Limits, v.CreatedAt, v.PublishedAt);

    public async Task<TenantSubscriptionDto?> SubscriptionDtoAsync(Guid tenantId, CancellationToken ct)
    {
        var sub = await db.Subscriptions.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        if (sub is null)
        {
            return null;
        }

        var v = await db.PlanVersions.AsNoTracking().FirstAsync(x => x.Id == sub.PlanVersionId, ct);
        return new TenantSubscriptionDto(sub.Id, tenantId, await VersionDtoAsync(v, ct), sub.StartsAt, sub.EndsAt, sub.BillingReference, ActorRefDto.From(sub.CreatedBy), sub.CreatedAt);
    }

    public IReadOnlyList<string> Flags(Tenant t, int studentCount, int? studentLimit)
    {
        var flags = new List<string>();
        if (t.ExpiresAt is { } exp && exp > Now && exp - Now < TimeSpan.FromDays(14))
        {
            flags.Add(TenantFlag.ExpiringSoon);
        }

        if (studentLimit is { } lim && studentCount > lim)
        {
            flags.Add(TenantFlag.OverLimit);
        }

        if (t.State == TenantLifecycleState.Draft)
        {
            flags.Add(TenantFlag.SetupIncomplete);
        }
        else if (t.CreatedAt < Now.AddDays(-14) && (t.LastActivityAt is null || t.LastActivityAt < Now.AddDays(-14)))
        {
            flags.Add(TenantFlag.NoRecentActivity);
        }

        return flags;
    }

    public async Task<TenantDetailDto> DetailAsync(Tenant t, CancellationToken ct)
    {
        var students = await schools.ActiveStudentsAsync(t.Id, ct);
        var g = await guardians.CountsAsync(t.Id, ct);
        var sub = await SubscriptionDtoAsync(t.Id, ct);
        var allowed = Can(P.PlatformLifecycleWrite) ? LifecycleRules.AllowedActions(t.State) : [];
        return new TenantDetailDto(
            t.Id, t.Slug, t.Name, t.State, t.OperationalMode, t.CountryCode, t.Region, sub?.PlanVersion.PlanName, t.ExpiresAt,
            students, g.Active, t.LastActivityAt, Flags(t, students, sub?.PlanVersion.Limits.GetValueOrDefault(LimitKey.StudentsMax)), t.CreatedAt,
            t.LegalName, t.Timezone, t.TermStart, t.TermEnd, t.DataPlacement, t.PreviousOperationalState,
            new TenantContactDto(t.ContactName, t.ContactEmail, t.ContactPhone), sub, allowed, t.UpdatedAt);
    }

    public static string ETag(Tenant t) => $"\"{t.UpdatedAt.UtcTicks.ToString(CultureInfo.InvariantCulture)}\"";

    [GeneratedRegex("^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$")]
    public static partial Regex Slug();

    [GeneratedRegex("^[A-Z]{2}$")]
    public static partial Regex Country();

    [GeneratedRegex("^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2})$")]
    public static partial Regex Timezone();
}

internal static class TenantEndpoints
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var g = endpoints.MapGroup("/v1/platform/tenants");

        g.MapGet("/", async (HttpRequest req, string? q, string? flag, Guid? planId, DateTimeOffset? expiringBefore, string? sort, string? direction, int? limit, string? cursor,
            PlatformSupport s, ISchoolStats schools, IGuardianStats guardians, CancellationToken ct) =>
        {
            var states = req.Query["state"].Where(x => !string.IsNullOrEmpty(x)).Select(x => x!).ToList();
            new Validator().OneOf("sort", sort, ["name", "createdAt", "expiresAt", "lastActivityAt"]).OneOf("direction", direction, ["asc", "desc"]).ThrowIfInvalid();
            var tenants = await s.Db.Tenants.AsNoTracking().ToListAsync(ct);
            var subs = await s.Db.Subscriptions.AsNoTracking().ToListAsync(ct);
            var versions = await s.Db.PlanVersions.AsNoTracking().ToListAsync(ct);
            var plans = await s.Db.Plans.AsNoTracking().ToDictionaryAsync(p => p.Id, ct);
            var students = await schools.ActiveStudentsByTenantAsync(ct);
            var active = await guardians.ActiveByTenantAsync(ct);

            var rows = tenants.Select(t =>
            {
                var sub = subs.FirstOrDefault(x => x.TenantId == t.Id);
                var v = sub is null ? null : versions.FirstOrDefault(x => x.Id == sub.PlanVersionId);
                var studentCount = students.GetValueOrDefault(t.Id);
                return (Tenant: t, PlanId: v?.PlanId, Dto: new TenantSummaryDto(
                    t.Id, t.Slug, t.Name, t.State, t.OperationalMode, t.CountryCode, t.Region, v is null ? null : plans[v.PlanId].Name, t.ExpiresAt,
                    studentCount, active.GetValueOrDefault(t.Id), t.LastActivityAt, s.Flags(t, studentCount, v?.Limits.GetValueOrDefault(LimitKey.StudentsMax)), t.CreatedAt));
            })
            .Where(r => states.Count == 0 || states.Contains(r.Tenant.State))
            .Where(r => string.IsNullOrWhiteSpace(q) || r.Tenant.Name.Contains(q, StringComparison.OrdinalIgnoreCase) || r.Tenant.Slug.Contains(q, StringComparison.OrdinalIgnoreCase))
            .Where(r => flag is null || r.Dto.Flags.Contains(flag))
            .Where(r => planId is null || r.PlanId == planId)
            .Where(r => expiringBefore is null || (r.Tenant.ExpiresAt is { } e && e < expiringBefore));

            IEnumerable<(Tenant Tenant, Guid? PlanId, TenantSummaryDto Dto)> ordered = (sort ?? "name") switch
            {
                "createdAt" => rows.OrderBy(r => r.Tenant.CreatedAt),
                "expiresAt" => rows.OrderBy(r => r.Tenant.ExpiresAt ?? DateTimeOffset.MaxValue),
                "lastActivityAt" => rows.OrderBy(r => r.Tenant.LastActivityAt ?? DateTimeOffset.MinValue),
                _ => rows.OrderBy(r => r.Tenant.Name, StringComparer.OrdinalIgnoreCase),
            };
            if (direction == "desc")
            {
                ordered = ordered.Reverse();
            }

            var all = ordered.Select(r => r.Dto).ToList();
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var page = all.Skip(skip).Take(take + 1).ToList();
            return new Page<TenantSummaryDto>(page.Take(take).ToList(), Paging.Next(skip, take, page.Count), take, all.Count);
        }).RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapPost("/", async (CreateTenantRequest b, PlatformSupport s, IStaffInvitations invitations, IAuditWriter audit, IUnitOfWork uow, CancellationToken ct) =>
        {
            var contact = b.PrimaryContact;
            new Validator()
                .Required("name", b.Name).MinLength("name", b.Name?.Trim(), 2).MaxLength("name", b.Name, 200)
                .Required("slug", b.Slug).Pattern("slug", b.Slug, PlatformSupport.Slug(), "slug: 3–48 lowercase letters, digits or hyphens.")
                .MaxLength("legalName", b.LegalName, 200)
                .Required("countryCode", b.CountryCode).Pattern("countryCode", b.CountryCode, PlatformSupport.Country(), "ISO 3166-1 alpha-2, e.g. US.")
                .Required("region", b.Region).MaxLength("region", b.Region, 32)
                .Required("timezone", b.Timezone).Pattern("timezone", b.Timezone, PlatformSupport.Timezone(), "IANA timezone, e.g. America/New_York.")
                .Required("termStartDate", b.TermStartDate).Required("termEndDate", b.TermEndDate)
                .Must(b.TermStartDate is null || b.TermEndDate is null || b.TermEndDate > b.TermStartDate, "termEndDate", "invalid_value", "Term end must be after term start.")
                .Required("initialState", b.InitialState).OneOf("initialState", b.InitialState, [TenantLifecycleState.Draft, TenantLifecycleState.Trial, TenantLifecycleState.PilotFree])
                .Must(b.InitialState != TenantLifecycleState.Trial || b.ExpiresAt is not null, "expiresAt", "required", "A trial needs an expiry date.")
                .Must(b.ExpiresAt is null || b.ExpiresAt > s.Now, "expiresAt", "invalid_value", "Expiry must be in the future.")
                .Required("primaryContact", contact)
                .Required("primaryContact.fullName", contact?.FullName).MaxLength("primaryContact.fullName", contact?.FullName, 120)
                .Required("primaryContact.email", contact?.Email).MaxLength("primaryContact.email", contact?.Email, 254)
                .Pattern("primaryContact.phone", contact?.Phone, Phone.E164(), "E.164, e.g. +15551234567.")
                .MaxLength("note", b.Note, 2000)
                .ThrowIfInvalid();

            var detail = await uow.ExecuteAsync(async t =>
            {
                if (await s.Db.Tenants.AnyAsync(x => x.Slug == b.Slug, t))
                {
                    throw Problem.Of(ErrorCodes.TenantSlugTaken);
                }

                var tenant = new Tenant(Guid.CreateVersion7(), b.Slug!, b.Name!.Trim(), b.Timezone!, b.CountryCode!, b.Region!, s.Now);
                tenant.SetLegalName(b.LegalName);
                tenant.Update(null, null, false, null, b.TermStartDate, b.TermEndDate, s.Now);
                tenant.SetContact(contact!.FullName!, contact.Email!.Trim().ToLowerInvariant(), contact.Phone, s.Now);
                tenant.Initialize(b.InitialState!, b.ExpiresAt);
                s.Db.Tenants.Add(tenant);
                if (b.PlanVersionId is { } pvId)
                {
                    var pv = await s.Db.PlanVersions.FirstOrDefaultAsync(v => v.Id == pvId && v.Status == PlanVersionStatus.Published, t)
                        ?? throw Problem.Of(ErrorCodes.PlanVersionNotPublished);
                    s.Db.Subscriptions.Add(new TenantSubscription(Guid.CreateVersion7(), tenant.Id, pv.Id, s.Now,
                        b.ExpiresAt ?? new DateTimeOffset(tenant.TermEnd.ToDateTime(new TimeOnly(23, 59, 59)), TimeSpan.Zero), null, s.Me, s.Now));
                }

                s.Db.LifecycleHistory.Add(new TenantLifecycleHistory(Guid.CreateVersion7(), tenant.Id, "create", null, tenant.State,
                    b.InitialState switch { TenantLifecycleState.Trial => LifecycleReasonCode.TrialRequested, TenantLifecycleState.PilotFree => LifecycleReasonCode.PilotProgram, _ => LifecycleReasonCode.Other }, b.Note, b.ExpiresAt, RefundStatus.None, s.Me, s.Now));
                audit.Write(new AuditEntry(AuditAction.TenantCreated, AuditOutcome.Success, "tenant", tenant.Id.ToString(),
                    Data: new Dictionary<string, object?> { ["slug"] = tenant.Slug, ["initialState"] = tenant.State }, TenantId: tenant.Id));
                await s.Db.SaveChangesAsync(t);
                if (b.InviteSchoolAdmin ?? true)
                {
                    await invitations.InviteAsync(tenant.Id, tenant.ContactEmail, tenant.ContactName, SchoolRole.SchoolAdmin, t);
                }

                return await s.DetailAsync(tenant, t);
            }, ct);
            return Results.Json(detail, JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(P.PlatformTenantsWrite).RequireIdempotency("platform.tenants.create");

        g.MapGet("/{tenantId:guid}", async (Guid tenantId, HttpResponse res, PlatformSupport s, CancellationToken ct) =>
        {
            var t = await s.TenantAsync(tenantId, ct);
            res.Headers.ETag = PlatformSupport.ETag(t);
            return await s.DetailAsync(t, ct);
        }).RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapPatch("/{tenantId:guid}", async (Guid tenantId, HttpRequest req, HttpResponse res, UpdateTenantRequest b, PlatformSupport s, IAuditWriter audit, CancellationToken ct) =>
        {
            var t = await s.TenantAsync(tenantId, ct);
            var ifMatch = req.Headers.IfMatch.ToString();
            if (!string.IsNullOrEmpty(ifMatch) && ifMatch != PlatformSupport.ETag(t))
            {
                throw Problem.Of(ErrorCodes.PreconditionFailed);
            }

            var c = b.PrimaryContact;
            new Validator()
                .Must(b.Name is not null || b.LegalName is not null || b.Timezone is not null || b.TermStartDate is not null || b.TermEndDate is not null || c is not null, "body", "min_properties", "Nothing to update.")
                .MinLength("name", b.Name?.Trim(), 2).MaxLength("name", b.Name, 200).MaxLength("legalName", b.LegalName, 200)
                .Pattern("timezone", b.Timezone, PlatformSupport.Timezone(), "IANA timezone, e.g. America/New_York.")
                .Must((b.TermEndDate ?? t.TermEnd) > (b.TermStartDate ?? t.TermStart), "termEndDate", "invalid_value", "Term end must be after term start.")
                .Must(c is null || (!string.IsNullOrWhiteSpace(c.FullName) && !string.IsNullOrWhiteSpace(c.Email)), "primaryContact", "required", "Contact needs fullName and email.")
                .Pattern("primaryContact.phone", c?.Phone, Phone.E164(), "E.164, e.g. +15551234567.")
                .ThrowIfInvalid();
            t.Update(b.Name?.Trim(), b.LegalName, b.LegalName is not null, b.Timezone, b.TermStartDate, b.TermEndDate, s.Now);
            if (c is not null)
            {
                t.SetContact(c.FullName!, c.Email!.Trim().ToLowerInvariant(), c.Phone, s.Now);
            }

            audit.Write(new AuditEntry(AuditAction.TenantUpdated, AuditOutcome.Success, "tenant", t.Id.ToString(),
                Data: new Dictionary<string, object?> { ["fields"] = new[] { b.Name is null ? null : "name", b.LegalName is null ? null : "legalName", b.Timezone is null ? null : "timezone", b.TermStartDate is null ? null : "termStartDate", b.TermEndDate is null ? null : "termEndDate", c is null ? null : "primaryContact" }.Where(x => x is not null) }, TenantId: t.Id));
            await s.Db.SaveChangesAsync(ct);
            res.Headers.ETag = PlatformSupport.ETag(t);
            return await s.DetailAsync(t, ct);
        }).RequirePlatformPermission(P.PlatformTenantsWrite);

        g.MapPost("/{tenantId:guid}/lifecycle-transitions", async (Guid tenantId, LifecycleTransitionRequest b, PlatformSupport s, IAuditWriter audit, IUnitOfWork uow, CancellationToken ct) =>
        {
            new Validator()
                .Required("action", b.Action).OneOf("action", b.Action, TenantLifecycleAction.All)
                .Required("expectedState", b.ExpectedState).OneOf("expectedState", b.ExpectedState, TenantLifecycleState.All)
                .Required("reasonCode", b.ReasonCode).OneOf("reasonCode", b.ReasonCode, LifecycleReasonCode.All)
                .MaxLength("note", b.Note, 2000)
                .OneOf("targetState", b.TargetState, [TenantLifecycleState.Trial, TenantLifecycleState.PilotFree, TenantLifecycleState.ActivePaid, TenantLifecycleState.ManualOverride])
                .Must(b.RetentionDays is null or (>= 30 and <= 365), "retentionDays", "invalid_value", "retentionDays must be 30–365.")
                .OneOf("refundStatus", b.RefundStatus, RefundStatus.All)
                .ThrowIfInvalid();

            return await uow.ExecuteAsync(async t =>
            {
                var tenant = await s.TenantAsync(tenantId, t);
                if (b.ExpectedState != tenant.State)
                {
                    throw Problem.Of(ErrorCodes.LifecycleStateChanged, meta: new Dictionary<string, object?> { ["currentState"] = tenant.State });
                }

                if (!LifecycleRules.IsAllowed(b.Action!, tenant.State))
                {
                    throw Problem.Of(ErrorCodes.InvalidLifecycleTransition, meta: new Dictionary<string, object?>
                    {
                        ["currentState"] = tenant.State,
                        ["allowedActions"] = LifecycleRules.AllowedActions(tenant.State),
                    });
                }

                new Validator()
                    .Must(!LifecycleRules.ActionsRequiringExpiry.Contains(b.Action) || b.ExpiresAt is not null, "expiresAt", "required", "This action requires an expiry date.")
                    .Must(b.ExpiresAt is null || b.ExpiresAt > s.Now, "expiresAt", "invalid_value", "Expiry must be in the future.")
                    .Must(b.Action != TenantLifecycleAction.ExtendExpiry || tenant.ExpiresAt is null || b.ExpiresAt > tenant.ExpiresAt, "expiresAt", "invalid_value", "New expiry must be later than the current one.")
                    .Must(!LifecycleRules.ActionsRequiringNameConfirmation.Contains(b.Action) || b.ConfirmTenantName == tenant.Name, "confirmTenantName", "mismatch", "Type the school name exactly to confirm.")
                    .ThrowIfInvalid();

                var hasSub = await s.Db.Subscriptions.AnyAsync(x => x.TenantId == tenant.Id, t);
                if (b.Action is TenantLifecycleAction.Activate or TenantLifecycleAction.ConvertToPaid && !hasSub && b.PlanVersionId is null)
                {
                    throw Problem.Of(ErrorCodes.PlanVersionNotPublished, "Assign a published plan first.");
                }

                if (b.PlanVersionId is { } pvId)
                {
                    var pv = await s.Db.PlanVersions.FirstOrDefaultAsync(v => v.Id == pvId && v.Status == PlanVersionStatus.Published, t)
                        ?? throw Problem.Of(ErrorCodes.PlanVersionNotPublished);
                    var ends = b.ExpiresAt ?? new DateTimeOffset(tenant.TermEnd.ToDateTime(new TimeOnly(23, 59, 59)), TimeSpan.Zero);
                    var existing = await s.Db.Subscriptions.FirstOrDefaultAsync(x => x.TenantId == tenant.Id, t);
                    if (existing is null)
                    {
                        s.Db.Subscriptions.Add(new TenantSubscription(Guid.CreateVersion7(), tenant.Id, pv.Id, s.Now, ends, null, s.Me, s.Now));
                    }
                    else
                    {
                        existing.Replace(pv.Id, existing.StartsAt, ends, existing.BillingReference, s.Me, s.Now);
                    }
                }

                var from = tenant.State;
                var to = LifecycleRules.TargetState(b.Action!, tenant.State, tenant.PreviousOperationalState, b.TargetState);
                tenant.Transition(b.Action!, to, b.ExpiresAt, s.Now);
                var note = b.Action == TenantLifecycleAction.StartOffboarding ? $"{b.Note} (retention {b.RetentionDays ?? 90} days)".Trim() : b.Note;
                s.Db.LifecycleHistory.Add(new TenantLifecycleHistory(Guid.CreateVersion7(), tenant.Id, b.Action!, from, to, b.ReasonCode!, note, b.ExpiresAt, b.RefundStatus ?? RefundStatus.None, s.Me, s.Now));
                audit.Write(new AuditEntry(AuditAction.TenantLifecycleChanged, AuditOutcome.Success, "tenant", tenant.Id.ToString(), b.ReasonCode,
                    new Dictionary<string, object?> { ["action"] = b.Action, ["from"] = from, ["to"] = to, ["expiresAt"] = b.ExpiresAt, ["refundStatus"] = b.RefundStatus }, tenant.Id));
                await s.Db.SaveChangesAsync(t);
                return await s.DetailAsync(tenant, t);
            }, ct);
        }).RequirePlatformPermission(P.PlatformLifecycleWrite).RequireIdempotency("platform.lifecycle");

        g.MapGet("/{tenantId:guid}/lifecycle-history", async (Guid tenantId, int? limit, string? cursor, PlatformSupport s, CancellationToken ct) =>
        {
            await s.TenantAsync(tenantId, ct);
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var rows = await s.Db.LifecycleHistory.AsNoTracking().Where(h => h.TenantId == tenantId).OrderByDescending(h => h.At).ThenByDescending(h => h.Id)
                .Skip(skip).Take(take + 1).ToListAsync(ct);
            var items = rows.Take(take).Select(h => new LifecycleHistoryEntryDto(h.Id, h.Action, h.FromState, h.ToState, h.ReasonCode, h.Note, h.ExpiresAt, h.RefundStatus, ActorRefDto.From(h.Actor), h.At)).ToList();
            return new Page<LifecycleHistoryEntryDto>(items, Paging.Next(skip, take, rows.Count), take);
        }).RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapGet("/{tenantId:guid}/subscription", async (Guid tenantId, PlatformSupport s, CancellationToken ct) =>
        {
            await s.TenantAsync(tenantId, ct);
            return await s.SubscriptionDtoAsync(tenantId, ct) ?? throw Problem.NotFound("No subscription assigned.");
        }).RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapPut("/{tenantId:guid}/subscription", async (Guid tenantId, SetSubscriptionRequest b, PlatformSupport s, IAuditWriter audit, CancellationToken ct) =>
        {
            new Validator()
                .Required("planVersionId", b.PlanVersionId).Required("startsAt", b.StartsAt).Required("endsAt", b.EndsAt)
                .Must(b.StartsAt is null || b.EndsAt is null || b.EndsAt > b.StartsAt, "endsAt", "invalid_value", "endsAt must be after startsAt.")
                .MaxLength("billingReference", b.BillingReference, 200).MaxLength("note", b.Note, 2000)
                .ThrowIfInvalid();
            var tenant = await s.TenantAsync(tenantId, ct);
            var pv = await s.Db.PlanVersions.FirstOrDefaultAsync(v => v.Id == b.PlanVersionId && v.Status == PlanVersionStatus.Published, ct)
                ?? throw Problem.Of(ErrorCodes.PlanVersionNotPublished);
            var existing = await s.Db.Subscriptions.FirstOrDefaultAsync(x => x.TenantId == tenant.Id, ct);
            if (existing is null)
            {
                s.Db.Subscriptions.Add(new TenantSubscription(Guid.CreateVersion7(), tenant.Id, pv.Id, b.StartsAt!.Value, b.EndsAt!.Value, b.BillingReference, s.Me, s.Now));
            }
            else
            {
                existing.Replace(pv.Id, b.StartsAt!.Value, b.EndsAt!.Value, b.BillingReference, s.Me, s.Now);
            }

            audit.Write(new AuditEntry(AuditAction.SubscriptionChanged, AuditOutcome.Success, "tenant", tenant.Id.ToString(),
                Data: new Dictionary<string, object?> { ["planVersionId"] = pv.Id, ["endsAt"] = b.EndsAt, ["note"] = b.Note }, TenantId: tenant.Id));
            await s.Db.SaveChangesAsync(ct);
            return (await s.SubscriptionDtoAsync(tenant.Id, ct))!;
        }).RequirePlatformPermission(P.PlatformSubscriptionsWrite);

        g.MapGet("/{tenantId:guid}/entitlements", async (Guid tenantId, EntitlementService entitlements, CancellationToken ct) =>
            ToDto(await entitlements.ResolveAsync(tenantId, ct))).RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapGet("/{tenantId:guid}/entitlement-overrides", async (Guid tenantId, bool? activeOnly, PlatformSupport s, CancellationToken ct) =>
        {
            await s.TenantAsync(tenantId, ct);
            var rows = await s.Db.Overrides.AsNoTracking().Where(o => o.TenantId == tenantId).OrderByDescending(o => o.CreatedAt).ToListAsync(ct);
            return new ItemsDto<EntitlementOverrideDto>(rows.Where(o => activeOnly != true || o.IsActive(s.Now)).Select(ToDto).ToList());
        }).RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapPost("/{tenantId:guid}/entitlement-overrides", async (Guid tenantId, CreateEntitlementOverrideRequest b, PlatformSupport s, IAuditWriter audit, CancellationToken ct) =>
        {
            new Validator()
                .Required("kind", b.Kind).OneOf("kind", b.Kind, [EntitlementKind.Feature, EntitlementKind.Limit])
                .Required("key", b.Key)
                .OneOf("key", b.Key, b.Kind == EntitlementKind.Limit ? LimitKey.All : FeatureKey.All)
                .Required("reasonCode", b.ReasonCode).OneOf("reasonCode", b.ReasonCode, LifecycleReasonCode.All)
                .Required("note", b.Note).MaxLength("note", b.Note, 2000)
                .Must(b.ExpiresAt is null || b.ExpiresAt > s.Now, "expiresAt", "invalid_value", "Expiry must be in the future.")
                .ThrowIfInvalid();
            var value = b.Value ?? JsonDocument.Parse("null").RootElement;
            var ok = b.Kind == EntitlementKind.Feature
                ? value.ValueKind is JsonValueKind.True or JsonValueKind.False
                : value.ValueKind == JsonValueKind.Null || (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n) && n >= 0);
            new Validator().Must(ok, "value", "invalid_value", b.Kind == EntitlementKind.Feature ? "Feature overrides need true or false." : "Limit overrides need a non-negative integer or null (unlimited).").ThrowIfInvalid();
            var tenant = await s.TenantAsync(tenantId, ct);
            var o = new EntitlementOverride(Guid.CreateVersion7(), tenant.Id, b.Kind!, b.Key!, value.GetRawText(), b.ReasonCode!, b.Note!, b.ExpiresAt, s.Me, s.Now);
            s.Db.Overrides.Add(o);
            audit.Write(new AuditEntry(AuditAction.OverrideApplied, AuditOutcome.Success, "entitlement_override", o.Id.ToString(), b.ReasonCode,
                new Dictionary<string, object?> { ["kind"] = o.Kind, ["key"] = o.Key, ["value"] = value, ["expiresAt"] = o.ExpiresAt }, tenant.Id));
            await s.Db.SaveChangesAsync(ct);
            return Results.Json(ToDto(o), JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(P.PlatformOverridesWrite);

        g.MapPost("/{tenantId:guid}/entitlement-overrides/{overrideId:guid}/revoke", async (Guid tenantId, Guid overrideId, RevokeRequest b, PlatformSupport s, IAuditWriter audit, CancellationToken ct) =>
        {
            new Validator().Required("note", b.Note).MaxLength("note", b.Note, 2000).ThrowIfInvalid();
            var o = await s.Db.Overrides.FirstOrDefaultAsync(x => x.Id == overrideId && x.TenantId == tenantId, ct) ?? throw Problem.NotFound();
            if (o.RevokedAt is not null)
            {
                throw Problem.Of(ErrorCodes.Conflict, "Override already removed.");
            }

            o.Revoke(s.Me, b.Note!, s.Now);
            audit.Write(new AuditEntry(AuditAction.OverrideRevoked, AuditOutcome.Success, "entitlement_override", o.Id.ToString(),
                Data: new Dictionary<string, object?> { ["key"] = o.Key }, TenantId: tenantId));
            await s.Db.SaveChangesAsync(ct);
            return ToDto(o);
        }).RequirePlatformPermission(P.PlatformOverridesWrite);

        g.MapGet("/{tenantId:guid}/usage", async (Guid tenantId, PlatformSupport s, EntitlementService entitlements, IGuardianStats guardians, IOtpUsage otp, CancellationToken ct) =>
        {
            await s.TenantAsync(tenantId, ct);
            var e = await entitlements.ResolveAsync(tenantId, ct);
            UsageCounterDto Counter(string key)
            {
                var l = e.Limits.First(x => x.Key == key);
                return new UsageCounterDto(l.Used ?? 0, l.Value);
            }

            var g = await guardians.CountsAsync(tenantId, ct);
            return new TenantUsageDto(tenantId, s.Now, Counter(LimitKey.StudentsMax), Counter(LimitKey.StaffMax), Counter(LimitKey.DisplaysMax),
                new GuardianUsageDto(g.PrimaryActive, g.PrimaryPending, g.AdditionalActive, g.Blocked, 0, 0),
                new PickupUsageDto(0, 0, 0, 0), // pickups arrive in Phase 4
                new OtpUsageDto(await otp.SentTodayAsync(ct), e.Limits.First(x => x.Key == LimitKey.OtpDailyBudget).Value),
                new TransferUsageDto(0, 0)); // device transfers arrive in Phase 6
        }).RequirePlatformPermission(P.PlatformTenantsRead);

        g.MapGet("/{tenantId:guid}/notes", async (Guid tenantId, string? category, int? limit, string? cursor, PlatformSupport s, CancellationToken ct) =>
        {
            new Validator().OneOf("category", category, NoteCategory.All).ThrowIfInvalid();
            await s.TenantAsync(tenantId, ct);
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var rows = await s.Db.Notes.AsNoTracking().Where(n => n.TenantId == tenantId && (category == null || n.Category == category))
                .OrderByDescending(n => n.Pinned).ThenByDescending(n => n.CreatedAt).Skip(skip).Take(take + 1).ToListAsync(ct);
            return new Page<SupportNoteDto>(rows.Take(take).Select(ToDto).ToList(), Paging.Next(skip, take, rows.Count), take);
        }).RequirePlatformPermission(P.PlatformNotesRead);

        g.MapPost("/{tenantId:guid}/notes", async (Guid tenantId, CreateSupportNoteRequest b, PlatformSupport s, IAuditWriter audit, CancellationToken ct) =>
        {
            new Validator()
                .Required("category", b.Category).OneOf("category", b.Category, NoteCategory.All)
                .Required("body", b.Body).MaxLength("body", b.Body, 5000)
                .OneOf("refundStatus", b.RefundStatus, RefundStatus.All)
                .ThrowIfInvalid();
            await s.TenantAsync(tenantId, ct);
            var n = new SupportNote(Guid.CreateVersion7(), tenantId, b.Category!, b.Body!, b.RefundStatus ?? RefundStatus.None, b.Pinned ?? false, s.Me, s.Now);
            s.Db.Notes.Add(n);
            audit.Write(new AuditEntry(AuditAction.NoteAdded, AuditOutcome.Success, "support_note", n.Id.ToString(),
                Data: new Dictionary<string, object?> { ["category"] = n.Category, ["refundStatus"] = n.RefundStatus }, TenantId: tenantId));
            await s.Db.SaveChangesAsync(ct);
            return Results.Json(ToDto(n), JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(P.PlatformNotesWrite);

        g.MapPost("/{tenantId:guid}/school-admin-invitations", async (Guid tenantId, SchoolAdminInvitationRequest b, PlatformSupport s, IStaffInvitations invitations, CancellationToken ct) =>
        {
            new Validator()
                .Required("email", b.Email).MaxLength("email", b.Email, 254)
                .Required("fullName", b.FullName).MaxLength("fullName", b.FullName, 120)
                .ThrowIfInvalid();
            await s.TenantAsync(tenantId, ct);
            var i = await invitations.InviteAsync(tenantId, b.Email!, b.FullName!, SchoolRole.SchoolAdmin, ct);
            return Results.Json(new StaffInvitationDto(i.Id, i.Email, i.FullName, i.Role, i.ExpiresAt, new ActorRefDto(i.InvitedByType, i.InvitedById, i.InvitedByName), i.CreatedAt),
                JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(P.PlatformTenantsWrite);
    }

    internal static EffectiveEntitlementsDto ToDto(Contracts.EffectiveEntitlementsInfo e) =>
        new(e.TenantId, e.State, e.OperationalMode,
            e.Features.Select(f => new EffectiveFeatureDto(f.Key, f.Enabled, f.Source, f.OverrideId, f.ExpiresAt)).ToList(),
            e.Limits.Select(l => new EffectiveLimitDto(l.Key, l.Value, l.Used, l.Source, l.OverrideId, l.ExpiresAt)).ToList(),
            e.ComputedAt);

    private static EntitlementOverrideDto ToDto(EntitlementOverride o) =>
        new(o.Id, o.TenantId, o.Kind, o.Key, o.ValueElement(), o.ReasonCode, o.Note, o.ExpiresAt, ActorRefDto.From(o.CreatedBy), o.CreatedAt,
            o.RevokedAt, o.RevokedBy is null ? null : ActorRefDto.From(o.RevokedBy), o.RevokeNote);

    private static SupportNoteDto ToDto(SupportNote n) =>
        new(n.Id, n.TenantId, n.Category, n.Body, n.RefundStatus, n.Pinned, ActorRefDto.From(n.Author), n.CreatedAt);
}
