using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Guardians.Contracts;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using P = HomeBell.BuildingBlocks.Domain.Contract.Permission;

namespace HomeBell.Modules.Schools.Infrastructure;

public sealed record DismissalWindowDto(int DayOfWeek, string OpensAt, string ClosesAt);

public sealed record TimeoutsDto(int SentOutReminderMinutes, int SentOutExceptionMinutes, int RequestedStaleMinutes, string EndOfDayTime);

public sealed record DismissalSettingsDto(List<DismissalWindowDto> Windows, bool SentOutStepEnabled, TimeoutsDto Timeouts);

public sealed record GeoPointDto(double Lat, double Lng);

public sealed record LocationRuleDto(bool Enabled, GeoPointDto? Center, int RadiusMeters, int MaxAccuracyMeters);

public sealed record DisplaySettingsDto(string NameFormat, bool ShowClass, bool ShowSection, string Theme);

public sealed record BrandingDto(string DisplayName, string? LogoUrl, string? PrimaryColor);

public sealed record NotificationSettingsDto(bool DailyDigestEnabled);

public sealed record SecuritySettingsDto(bool StaffMfaRequired);

public sealed record TenantSettingsDto(DismissalSettingsDto Dismissal, LocationRuleDto LocationRule, DisplaySettingsDto Display, BrandingDto Branding, NotificationSettingsDto Notifications, SecuritySettingsDto Security, string Locale)
{
    public static TenantSettingsDto Default(string schoolName) => new(
        new DismissalSettingsDto([.. Enumerable.Range(1, 5).Select(d => new DismissalWindowDto(d, "14:30", "16:00"))], true, new TimeoutsDto(5, 15, 30, "17:00")),
        new LocationRuleDto(false, null, 300, 100),
        new DisplaySettingsDto(DisplayNameFormat.FirstNameLastInitial, true, false, "auto"),
        new BrandingDto(schoolName, null, null),
        new NotificationSettingsDto(false),
        new SecuritySettingsDto(false),
        "en");
}

public sealed record RequestCountsDto(int Total, int Requested, int SentOut, int Acknowledged, int Cancelled, int Exception, int Resolved);

public sealed record StudentCountsDto(int Active, int Inactive, int OnHold);

public sealed record GuardianCountsDto(int Active, int PendingActivation, int Blocked, int Deactivated, int AdditionalActive);

public sealed record DisplayCountsDto(int Online, int Total);

public sealed record DashboardOverviewDto(DateOnly QueueDate, RequestCountsDto Requests, int Unresolved, double? MedianMinutesToAcknowledge, StudentCountsDto Students, GuardianCountsDto Guardians, DisplayCountsDto Displays, int DeviceTransfersLast7Days, int SuspiciousTransfersLast7Days, DateTimeOffset GeneratedAt);

public sealed record EffectiveLimitDto(string Key, int? Value, int? Used, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

public sealed record EffectiveFeatureDto(string Key, bool Enabled, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

public sealed record EffectiveEntitlementsDto(Guid TenantId, string State, string OperationalMode, IReadOnlyList<EffectiveFeatureDto> Features, IReadOnlyList<EffectiveLimitDto> Limits, DateTimeOffset ComputedAt);

public sealed record TenantSubscriptionViewDto(string State, string OperationalMode, string? PlanName, DateTimeOffset? ExpiresAt, int? DaysUntilExpiry, DateOnly TermStartDate, DateOnly TermEndDate, IReadOnlyList<EffectiveLimitDto> Limits);

public sealed record SectionDto(Guid Id, Guid ClassId, string Name, int StudentCount);

public sealed record SchoolClassDto(Guid Id, string Name, string? GradeLevel, int SortOrder, IReadOnlyList<SectionDto> Sections, int StudentCount);

public sealed record CreateClassRequest(string? Name, string? GradeLevel, int? SortOrder);

/// <summary>PATCH body; <c>gradeLevel: null</c> clears it, so presence is tracked separately.</summary>
public sealed record UpdateClassRequest(string? Name, JsonElement? GradeLevel, int? SortOrder);

public sealed record SectionNameRequest(string? Name);

public sealed record ActorRefDto(string Type, Guid? Id, string DisplayName);

public sealed record AuditLogEntryDto(
    Guid Id, DateTimeOffset OccurredAt, Guid? TenantId, string? TenantName, string Action, string Outcome, ActorRefDto Actor, ActorRefDto? OnBehalfOf,
    string? TargetType, string? TargetId, string? TargetLabel, string? ReasonCode, string? RequestId, Guid? DeviceId, JsonElement Data);

internal static partial class SchoolEndpoints
{
    private const string T = "/v1/t/{tenantId:guid}";

    [GeneratedRegex("^([01]\\d|2[0-3]):[0-5]\\d$")]
    private static partial Regex LocalTime();

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex Color();

    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var t = endpoints.MapGroup(T);

        t.MapGet("/overview", async (Guid tenantId, SchoolsDbContext db, IGuardianStats guardians, ITenantDirectory tenants, IClock clock, CancellationToken ct) =>
        {
            var info = await tenants.FindAsync(tenantId, ct);
            var students = await db.Students.AsNoTracking().GroupBy(s => new { s.Status, s.DismissalEligibility }).Select(g => new { g.Key.Status, g.Key.DismissalEligibility, Count = g.Count() }).ToListAsync(ct);
            var g = await guardians.CountsAsync(tenantId, ct);
            return new DashboardOverviewDto(
                TodayIn(info?.Timezone, clock.UtcNow),
                new RequestCountsDto(0, 0, 0, 0, 0, 0, 0), 0, null, // the live queue arrives in Phase 4
                new StudentCountsDto(
                    students.Where(s => s.Status == StudentStatus.Active).Sum(s => s.Count),
                    students.Where(s => s.Status == StudentStatus.Inactive).Sum(s => s.Count),
                    students.Where(s => s.Status == StudentStatus.Active && s.DismissalEligibility == DismissalEligibility.Hold).Sum(s => s.Count)),
                new GuardianCountsDto(g.PrimaryActive, g.PrimaryPending, g.Blocked, g.Deactivated, g.AdditionalActive),
                new DisplayCountsDto(0, 0), 0, 0, clock.UtcNow);
        }).RequireTenantPermission(P.SchoolQueueRead);

        t.MapGet("/entitlements", async (Guid tenantId, IEntitlements entitlements, CancellationToken ct) =>
        {
            var e = await entitlements.ResolveAsync(tenantId, ct);
            return new EffectiveEntitlementsDto(e.TenantId, e.State, e.OperationalMode,
                e.Features.Select(f => new EffectiveFeatureDto(f.Key, f.Enabled, f.Source, f.OverrideId, f.ExpiresAt)).ToList(),
                e.Limits.Select(Limit).ToList(), e.ComputedAt);
        }).RequireTenantPermission(P.SchoolSettingsRead);

        t.MapGet("/subscription", async (Guid tenantId, IEntitlements entitlements, ITenantPlans plans, IClock clock, CancellationToken ct) =>
        {
            var e = await entitlements.ResolveAsync(tenantId, ct);
            var plan = await plans.FindAsync(tenantId, ct) ?? throw Problem.NotFound();
            int? days = plan.ExpiresAt is { } exp ? Math.Max(0, (int)Math.Ceiling((exp - clock.UtcNow).TotalDays)) : null;
            return new TenantSubscriptionViewDto(e.State, e.OperationalMode, plan.PlanName, plan.ExpiresAt, days, plan.TermStart, plan.TermEnd, e.Limits.Select(Limit).ToList());
        }).RequireTenantPermission(P.SchoolSubscriptionRead);

        t.MapGet("/settings", async (Guid tenantId, HttpResponse res, SchoolsDbContext db, ITenantDirectory tenants, CancellationToken ct) =>
        {
            var (dto, record) = await LoadSettingsAsync(db, tenants, tenantId, ct);
            res.Headers.ETag = SettingsETag(record);
            return dto;
        }).RequireTenantPermission(P.SchoolSettingsRead);

        t.MapPut("/settings", async (Guid tenantId, HttpRequest req, HttpResponse res, TenantSettingsDto b, SchoolsDbContext db, ITenantDirectory tenants, IEntitlements entitlements, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            var (_, record) = await LoadSettingsAsync(db, tenants, tenantId, ct);
            var ifMatch = req.Headers.IfMatch.ToString();
            if (!string.IsNullOrEmpty(ifMatch) && ifMatch != SettingsETag(record))
            {
                throw Problem.Of(ErrorCodes.PreconditionFailed);
            }

            ValidateSettings(b);
            if (b.LocationRule.Enabled && !await entitlements.HasFeatureAsync(tenantId, FeatureKey.DismissalLocationRule, ct))
            {
                throw Problem.Of(ErrorCodes.FeatureNotEntitled, meta: new Dictionary<string, object?> { ["feature"] = FeatureKey.DismissalLocationRule });
            }

            var json = JsonSerializer.Serialize(b, JsonDefaults.Options);
            if (record is null)
            {
                record = new TenantSettingsRecord(tenantId, json, clock.UtcNow);
                db.Settings.Add(record);
            }
            else
            {
                record.Replace(json, clock.UtcNow);
            }

            audit.Write(new AuditEntry(AuditAction.SettingsUpdated, AuditOutcome.Success, "tenant_settings", tenantId.ToString()));
            await db.SaveChangesAsync(ct);
            res.Headers.ETag = SettingsETag(record);
            return b;
        }).RequireTenantPermission(P.SchoolSettingsWrite, isWrite: true);

        t.MapGet("/audit-logs", async (Guid tenantId, string? action, Guid? actorId, string? targetId, DateTimeOffset? from, DateTimeOffset? to, int? limit, string? cursor, SchoolsDbContext db, CancellationToken ct) =>
        {
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            // RLS + the explicit filter keep this to the caller's tenant.
            var rows = await db.AuditLog.AsNoTracking()
                .Where(a => a.TenantId == tenantId)
                .Where(a => action == null || a.Action == action)
                .Where(a => actorId == null || a.ActorId == actorId)
                .Where(a => targetId == null || a.TargetId == targetId)
                .Where(a => from == null || a.OccurredAt >= from)
                .Where(a => to == null || a.OccurredAt < to)
                .OrderByDescending(a => a.OccurredAt).ThenByDescending(a => a.Id)
                .Skip(skip).Take(take + 1).ToListAsync(ct);
            var items = rows.Take(take).Select(r => new AuditLogEntryDto(r.Id, r.OccurredAt, r.TenantId, null, r.Action, r.Outcome,
                new ActorRefDto(r.ActorType, r.ActorId, r.ActorDisplay), null, r.TargetType, r.TargetId, null, r.ReasonCode, r.RequestId, r.DeviceId,
                JsonDocument.Parse(string.IsNullOrEmpty(r.Data) ? "{}" : r.Data).RootElement.Clone())).ToList();
            return new Page<AuditLogEntryDto>(items, Paging.Next(skip, take, rows.Count), take);
        }).RequireTenantPermission(P.SchoolAuditRead);

        // ── classes & sections ─────────────────────────────────────────
        t.MapGet("/classes", async (SchoolsDbContext db, CancellationToken ct) => new { items = await ClassesAsync(db, null, ct) })
            .RequireTenantPermission(P.SchoolStudentsRead);

        t.MapPost("/classes", async (Guid tenantId, CreateClassRequest b, SchoolsDbContext db, CancellationToken ct) =>
        {
            new Validator().Required("name", b.Name).MaxLength("name", b.Name, 60).MaxLength("gradeLevel", b.GradeLevel, 30).ThrowIfInvalid();
            var name = b.Name!.Trim();
            if (await db.Classes.AnyAsync(c => c.Name.ToLower() == name.ToLower(), ct))
            {
                throw Problem.Of(ErrorCodes.Conflict, "A class with this name exists.");
            }

            var c = new SchoolClass(Guid.CreateVersion7(), tenantId, name, b.GradeLevel, b.SortOrder ?? 0);
            db.Classes.Add(c);
            await db.SaveChangesAsync(ct);
            return Results.Json((await ClassesAsync(db, c.Id, ct))[0], JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        t.MapPatch("/classes/{classId:guid}", async (Guid classId, UpdateClassRequest b, SchoolsDbContext db, CancellationToken ct) =>
        {
            var grade = b.GradeLevel is { ValueKind: JsonValueKind.String } g ? g.GetString() : null;
            new Validator()
                .Must(b.Name is not null || b.GradeLevel is not null || b.SortOrder is not null, "body", "min_properties", "Nothing to update.")
                .MinLength("name", b.Name?.Trim(), 1).MaxLength("name", b.Name, 60).MaxLength("gradeLevel", grade, 30)
                .ThrowIfInvalid();
            var c = await db.Classes.FirstOrDefaultAsync(x => x.Id == classId, ct) ?? throw Problem.NotFound();
            c.Update(b.Name?.Trim(), grade, b.GradeLevel is not null, b.SortOrder);
            await db.SaveChangesAsync(ct);
            return (await ClassesAsync(db, c.Id, ct))[0];
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        t.MapDelete("/classes/{classId:guid}", async (Guid classId, SchoolsDbContext db, CancellationToken ct) =>
        {
            var c = await db.Classes.FirstOrDefaultAsync(x => x.Id == classId, ct) ?? throw Problem.NotFound();
            if (await db.Students.AnyAsync(s => s.ClassId == classId, ct))
            {
                throw Problem.Of(ErrorCodes.ClassNotEmpty);
            }

            db.Sections.RemoveRange(await db.Sections.Where(s => s.ClassId == classId).ToListAsync(ct));
            db.Classes.Remove(c);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        t.MapPost("/classes/{classId:guid}/sections", async (Guid tenantId, Guid classId, SectionNameRequest b, SchoolsDbContext db, CancellationToken ct) =>
        {
            new Validator().Required("name", b.Name).MaxLength("name", b.Name, 30).ThrowIfInvalid();
            _ = await db.Classes.FirstOrDefaultAsync(x => x.Id == classId, ct) ?? throw Problem.NotFound();
            var name = b.Name!.Trim();
            if (await db.Sections.AnyAsync(s => s.ClassId == classId && s.Name.ToLower() == name.ToLower(), ct))
            {
                throw Problem.Of(ErrorCodes.Conflict, "A section with this name exists.");
            }

            var s = new Section(Guid.CreateVersion7(), tenantId, classId, name);
            db.Sections.Add(s);
            await db.SaveChangesAsync(ct);
            return Results.Json(new SectionDto(s.Id, s.ClassId, s.Name, 0), JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        t.MapPatch("/sections/{sectionId:guid}", async (Guid sectionId, SectionNameRequest b, SchoolsDbContext db, CancellationToken ct) =>
        {
            new Validator().Required("name", b.Name).MaxLength("name", b.Name, 30).ThrowIfInvalid();
            var s = await db.Sections.FirstOrDefaultAsync(x => x.Id == sectionId, ct) ?? throw Problem.NotFound();
            s.Rename(b.Name!.Trim());
            await db.SaveChangesAsync(ct);
            return new SectionDto(s.Id, s.ClassId, s.Name, await db.Students.CountAsync(x => x.SectionId == s.Id, ct));
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        t.MapDelete("/sections/{sectionId:guid}", async (Guid sectionId, SchoolsDbContext db, CancellationToken ct) =>
        {
            var s = await db.Sections.FirstOrDefaultAsync(x => x.Id == sectionId, ct) ?? throw Problem.NotFound();
            if (await db.Students.AnyAsync(x => x.SectionId == sectionId, ct))
            {
                throw Problem.Of(ErrorCodes.ClassNotEmpty);
            }

            db.Sections.Remove(s);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);
    }

    internal static async Task<List<SchoolClassDto>> ClassesAsync(SchoolsDbContext db, Guid? only, CancellationToken ct)
    {
        var classes = await db.Classes.AsNoTracking().Where(c => only == null || c.Id == only).OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync(ct);
        var ids = classes.Select(c => c.Id).ToList();
        var sections = await db.Sections.AsNoTracking().Where(s => ids.Contains(s.ClassId)).OrderBy(s => s.Name).ToListAsync(ct);
        var counts = await db.Students.AsNoTracking().Where(s => ids.Contains(s.ClassId) && s.Status == StudentStatus.Active)
            .GroupBy(s => new { s.ClassId, s.SectionId }).Select(g => new { g.Key.ClassId, g.Key.SectionId, Count = g.Count() }).ToListAsync(ct);
        return classes.Select(c => new SchoolClassDto(c.Id, c.Name, c.GradeLevel, c.SortOrder,
            sections.Where(s => s.ClassId == c.Id).Select(s => new SectionDto(s.Id, c.Id, s.Name, counts.Where(x => x.SectionId == s.Id).Sum(x => x.Count))).ToList(),
            counts.Where(x => x.ClassId == c.Id).Sum(x => x.Count))).ToList();
    }

    internal static DateOnly TodayIn(string? timezone, DateTimeOffset now)
    {
        try
        {
            if (timezone is not null && TimeZoneInfo.TryFindSystemTimeZoneById(timezone, out var tz))
            {
                return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, tz).DateTime);
            }
        }
        catch (TimeZoneNotFoundException)
        {
        }

        return DateOnly.FromDateTime(now.UtcDateTime);
    }

    private static EffectiveLimitDto Limit(EffectiveLimitInfo l) => new(l.Key, l.Value, l.Used, l.Source, l.OverrideId, l.ExpiresAt);

    private static async Task<(TenantSettingsDto Dto, TenantSettingsRecord? Record)> LoadSettingsAsync(SchoolsDbContext db, ITenantDirectory tenants, Guid tenantId, CancellationToken ct)
    {
        var record = await db.Settings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        if (record is not null)
        {
            return (JsonSerializer.Deserialize<TenantSettingsDto>(record.Json, JsonDefaults.Options)!, record);
        }

        var name = (await tenants.FindAsync(tenantId, ct))?.Name ?? "School";
        return (TenantSettingsDto.Default(name), null);
    }

    private static string SettingsETag(TenantSettingsRecord? r) => $"\"{(r?.UpdatedAt.UtcTicks ?? 0).ToString(CultureInfo.InvariantCulture)}\"";

    private static void ValidateSettings(TenantSettingsDto b)
    {
        var v = new Validator()
            .Required("dismissal", b.Dismissal).Required("locationRule", b.LocationRule).Required("display", b.Display)
            .Required("branding", b.Branding).Required("notifications", b.Notifications).Required("security", b.Security).Required("locale", b.Locale);
        v.ThrowIfInvalid();
        var d = b.Dismissal;
        v.Required("dismissal.windows", d.Windows).Required("dismissal.timeouts", d.Timeouts).ThrowIfInvalid();
        v.Must(d.Windows.Count <= 14, "dismissal.windows", "max_items", "At most 14 windows.");
        for (var i = 0; i < d.Windows.Count; i++)
        {
            var w = d.Windows[i];
            v.Must(w.DayOfWeek is >= 1 and <= 7, $"dismissal.windows[{i}].dayOfWeek", "invalid_value", "Day of week 1 (Monday) – 7 (Sunday).")
             .Pattern($"dismissal.windows[{i}].opensAt", w.OpensAt, LocalTime(), "Use HH:mm.")
             .Pattern($"dismissal.windows[{i}].closesAt", w.ClosesAt, LocalTime(), "Use HH:mm.")
             .Must(string.CompareOrdinal(w.ClosesAt, w.OpensAt) > 0, $"dismissal.windows[{i}].closesAt", "invalid_value", "A window must close after it opens.");
        }

        var to = d.Timeouts;
        v.Must(to.SentOutReminderMinutes is >= 1 and <= 30, "dismissal.timeouts.sentOutReminderMinutes", "invalid_value", "1–30 minutes.")
         .Must(to.SentOutExceptionMinutes is >= 5 and <= 60, "dismissal.timeouts.sentOutExceptionMinutes", "invalid_value", "5–60 minutes.")
         .Must(to.RequestedStaleMinutes is >= 10 and <= 120, "dismissal.timeouts.requestedStaleMinutes", "invalid_value", "10–120 minutes.")
         .Pattern("dismissal.timeouts.endOfDayTime", to.EndOfDayTime, LocalTime(), "Use HH:mm.")
         .Must(b.LocationRule.RadiusMeters is >= 50 and <= 5000, "locationRule.radiusMeters", "invalid_value", "50–5000 m.")
         .Must(b.LocationRule.MaxAccuracyMeters is >= 10 and <= 1000, "locationRule.maxAccuracyMeters", "invalid_value", "10–1000 m.")
         .Must(!b.LocationRule.Enabled || b.LocationRule.Center is not null, "locationRule.center", "required", "Set the school location to enable the rule.")
         .Must(b.LocationRule.Center is null || (b.LocationRule.Center.Lat is >= -90 and <= 90 && b.LocationRule.Center.Lng is >= -180 and <= 180), "locationRule.center", "invalid_value", "Invalid coordinates.")
         .OneOf("display.nameFormat", b.Display.NameFormat, DisplayNameFormat.All)
         .OneOf("display.theme", b.Display.Theme, ["light", "dark", "auto"])
         .Required("branding.displayName", b.Branding.DisplayName).MaxLength("branding.displayName", b.Branding.DisplayName, 120)
         .Pattern("branding.primaryColor", b.Branding.PrimaryColor, Color(), "Use #RRGGBB.")
         .Must(b.Branding.LogoUrl is null || Uri.TryCreate(b.Branding.LogoUrl, UriKind.Absolute, out _), "branding.logoUrl", "invalid_format", "Must be an absolute URL.")
         .MaxLength("locale", b.Locale, 10)
         .ThrowIfInvalid();
    }
}
