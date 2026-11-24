using System.Globalization;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Guardians.Contracts;
using HomeBell.Modules.Guardians.Domain;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using P = HomeBell.BuildingBlocks.Domain.Contract.Permission;

namespace HomeBell.Modules.Guardians.Infrastructure;

public sealed record GuardianStudentRefDto(Guid StudentId, string FullName, string ClassName, string Relationship, bool IsPrimary);

public sealed record DeviceSummaryDto(Guid DeviceId, string Platform, string Model, string State, DateTimeOffset ActivatedAt, DateTimeOffset? LastSeenAt);

public sealed record GuardianDto(
    Guid Id, Guid UserId, string Kind, string FullName, string MaskedPhone, string? Phone, string State, string? StateReason, DateTimeOffset? StateChangedAt,
    IReadOnlyList<GuardianStudentRefDto> Students, object? Validity, object? InvitedBy, DateTimeOffset? ActivatedAt, DateTimeOffset? LastActiveAt,
    DeviceSummaryDto? ActiveDevice, DateTimeOffset? LastTransferAt, DateTimeOffset? NextTransferAllowedAt, int SuspiciousTransfersLast30Days, DateTimeOffset CreatedAt);

public sealed record GuardianLinkInput(Guid? StudentId, string? Relationship, bool? IsPrimary);

public sealed record CreateGuardianRequest(string? FullName, string? Phone, List<GuardianLinkInput>? Links);

public sealed record UpdateGuardianRequest(string? FullName, string? Phone);

public sealed record GuardianStateChangeRequest(string? Reason, string? Note);

public sealed record GuardianDeviceInfoDto(DeviceSummaryDto? ActiveDevice, DateTimeOffset? NextTransferAllowedAt, IReadOnlyList<object> Transfers, IReadOnlyList<object> Overrides, int RemainingSchoolOverridesThisTerm);

/// <summary>Builds the school-side Guardian view (students from Schools, device from Identity).</summary>
internal sealed class GuardianViews(GuardiansDbContext db, IStudentDirectory students, IUserDirectory users, TenantAccessHolder access)
{
    public bool CanSeePhone => access.Access?.Permissions.Contains(P.SchoolGuardiansWrite) == true;

    public async Task<IReadOnlyList<GuardianDto>> BuildAsync(Guid tenantId, IReadOnlyList<Guardian> guardians, CancellationToken ct)
    {
        var ids = guardians.Select(g => g.Id).ToList();
        var links = await db.Links.AsNoTracking().Where(l => ids.Contains(l.GuardianId) && l.RemovedAt == null).ToListAsync(ct);
        var studentRefs = await students.GetManyAsync(tenantId, links.Select(l => l.StudentId).Distinct().ToList(), ct);
        var devices = await users.ActiveDevicesAsync(guardians.Select(g => g.UserId).Distinct().ToList(), ct);
        return guardians.Select(g => new GuardianDto(
            g.Id, g.UserId, g.Kind, g.FullName, Phone.Mask(g.Phone), CanSeePhone ? g.Phone : null, g.State, g.StateReason, g.StateChangedAt,
            links.Where(l => l.GuardianId == g.Id && studentRefs.ContainsKey(l.StudentId))
                .Select(l => new GuardianStudentRefDto(l.StudentId, studentRefs[l.StudentId].FullName, studentRefs[l.StudentId].ClassName, l.Relationship, l.IsPrimary)).ToList(),
            null, null, g.ActivatedAt, g.LastActiveAt,
            devices.TryGetValue(g.UserId, out var d) ? new DeviceSummaryDto(d.DeviceId, d.Platform, d.Model, d.State, d.ActivatedAt, d.LastSeenAt) : null,
            null, null, 0, g.CreatedAt)).ToList();
    }

    public async Task<GuardianDto> BuildAsync(Guid tenantId, Guardian g, CancellationToken ct) => (await BuildAsync(tenantId, [g], ct))[0];
}

internal static class GuardianEndpoints
{
    private const string Base = "/v1/t/{tenantId:guid}/guardians";

    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var g = endpoints.MapGroup(Base);

        g.MapGet("/", async (Guid tenantId, string? q, string? state, string? kind, Guid? studentId, int? limit, string? cursor, GuardiansDbContext db, GuardianViews views, CancellationToken ct) =>
        {
            new Validator().OneOf("state", state, GuardianState.All).OneOf("kind", kind, GuardianKind.All).ThrowIfInvalid();
            var query = db.Guardians.AsNoTracking().Where(x => state == null || x.State == state).Where(x => kind == null || x.Kind == kind);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = q.Trim();
                query = query.Where(x => EF.Functions.ILike(x.FullName, $"%{term}%") || x.Phone.Contains(term));
            }

            if (studentId is { } sid)
            {
                query = query.Where(x => db.Links.Any(l => l.GuardianId == x.Id && l.StudentId == sid && l.RemovedAt == null));
            }

            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var rows = await query.OrderBy(x => x.FullName).ThenBy(x => x.Id).Skip(skip).Take(take + 1).ToListAsync(ct);
            return new Page<GuardianDto>(await views.BuildAsync(tenantId, rows.Take(take).ToList(), ct), Paging.Next(skip, take, rows.Count), take);
        }).RequireTenantPermission(P.SchoolGuardiansRead);

        g.MapPost("/", async (Guid tenantId, CreateGuardianRequest b, GuardiansDbContext db, GuardianLinks linksSvc, IStudentDirectory students, GuardianViews views, IUnitOfWork uow, IClock clock, CancellationToken ct) =>
        {
            new Validator()
                .Required("fullName", b.FullName).MaxLength("fullName", b.FullName, 120)
                .Required("phone", b.Phone).Pattern("phone", b.Phone, Phone.E164(), "Phone must be in international format, e.g. +15551234567.")
                .Must(b.Links is { Count: > 0 }, "links", "min_items", "Link at least one student.")
                .ThrowIfInvalid();
            ValidateLinks(b.Links!);
            var refs = await students.GetManyAsync(tenantId, b.Links!.Select(l => l.StudentId!.Value).Distinct().ToList(), ct);
            if (refs.Count != b.Links!.Select(l => l.StudentId).Distinct().Count())
            {
                throw Problem.NotFound("Student not found.");
            }

            var guardian = await uow.ExecuteAsync(async t =>
            {
                if (await db.Guardians.AnyAsync(x => x.Phone == b.Phone, t))
                {
                    throw Problem.Of(ErrorCodes.GuardianPhoneInUse);
                }

                foreach (var l in b.Links!.Where(l => l.IsPrimary == true))
                {
                    if (await db.Links.AnyAsync(x => x.StudentId == l.StudentId && x.IsPrimary && x.RemovedAt == null, t))
                    {
                        throw Problem.Of(ErrorCodes.PrimaryGuardianExists);
                    }
                }

                var (created, _) = await linksSvc.EnsurePrimaryAsync(tenantId, b.FullName!.Trim(), b.Phone!, t);
                foreach (var l in b.Links!)
                {
                    db.Links.Add(new GuardianStudentLink(Guid.CreateVersion7(), tenantId, created.Id, l.StudentId!.Value, l.Relationship!, l.IsPrimary!.Value, clock.UtcNow));
                }

                await db.SaveChangesAsync(t);
                return created;
            }, ct);
            return Results.Json(await views.BuildAsync(tenantId, guardian, ct), JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequireTenantPermission(P.SchoolGuardiansWrite, isWrite: true);

        g.MapGet("/{guardianId:guid}", async (Guid tenantId, Guid guardianId, HttpResponse res, GuardiansDbContext db, GuardianViews views, CancellationToken ct) =>
        {
            var guardian = await Find(db, guardianId, ct);
            res.Headers.ETag = ETag(guardian);
            return await views.BuildAsync(tenantId, guardian, ct);
        }).RequireTenantPermission(P.SchoolGuardiansRead);

        g.MapPatch("/{guardianId:guid}", async (Guid tenantId, Guid guardianId, HttpRequest req, UpdateGuardianRequest b, GuardiansDbContext db, GuardianViews views,
            IUserAccounts accounts, IAuditWriter audit, IClock clock, IUnitOfWork uow, CancellationToken ct) =>
        {
            new Validator()
                .Must(b.FullName is not null || b.Phone is not null, "body", "min_properties", "Nothing to update.")
                .MaxLength("fullName", b.FullName, 120)
                .Pattern("phone", b.Phone, Phone.E164(), "Phone must be in international format, e.g. +15551234567.")
                .ThrowIfInvalid();
            return await uow.ExecuteAsync(async t =>
            {
                var guardian = await Find(db, guardianId, t);
                var ifMatch = req.Headers.IfMatch.ToString();
                if (!string.IsNullOrEmpty(ifMatch) && ifMatch != ETag(guardian))
                {
                    throw Problem.Of(ErrorCodes.PreconditionFailed);
                }

                if (b.FullName is { Length: > 0 } name)
                {
                    guardian.Rename(name.Trim(), clock.UtcNow);
                }

                if (b.Phone is { } phone && phone != guardian.Phone)
                {
                    if (await db.Guardians.AnyAsync(x => x.Phone == phone && x.Id != guardian.Id, t))
                    {
                        throw Problem.Of(ErrorCodes.GuardianPhoneInUse);
                    }

                    var userId = await accounts.EnsureByPhoneAsync(phone, guardian.FullName, t);
                    guardian.ChangePhone(phone, userId, clock.UtcNow);
                }

                audit.Write(new AuditEntry(AuditAction.GuardianUpdated, AuditOutcome.Success, "guardian", guardian.Id.ToString(),
                    Data: new Dictionary<string, object?> { ["fullName"] = b.FullName is not null, ["phone"] = b.Phone is null ? null : Phone.Mask(b.Phone) }));
                await db.SaveChangesAsync(t);
                return await views.BuildAsync(tenantId, guardian, t);
            }, ct);
        }).RequireTenantPermission(P.SchoolGuardiansWrite, isWrite: true);

        MapStateChange(g, "block", P.SchoolGuardiansBlock, [GuardianState.Active, GuardianState.PendingActivation], AuditAction.GuardianBlocked, (x, r, at) => x.Block(r, at));
        MapStateChange(g, "unblock", P.SchoolGuardiansBlock, [GuardianState.Blocked], AuditAction.GuardianUnblocked, (x, _, at) => x.Restore(at));
        MapStateChange(g, "deactivate", P.SchoolGuardiansWrite, [GuardianState.Active, GuardianState.PendingActivation, GuardianState.Blocked], AuditAction.GuardianDeactivated, (x, r, at) => x.Deactivate(r, at));
        MapStateChange(g, "reactivate", P.SchoolGuardiansWrite, [GuardianState.Deactivated], AuditAction.GuardianReactivated, (x, _, at) => x.Restore(at));

        g.MapPost("/{guardianId:guid}/links", async (Guid tenantId, Guid guardianId, GuardianLinkInput b, GuardiansDbContext db, IStudentDirectory students, GuardianViews views, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            ValidateLinks([b]);
            var guardian = await Find(db, guardianId, ct);
            if ((await students.GetManyAsync(tenantId, [b.StudentId!.Value], ct)).Count == 0)
            {
                throw Problem.NotFound("Student not found.");
            }

            if (await db.Links.AnyAsync(l => l.GuardianId == guardianId && l.StudentId == b.StudentId && l.RemovedAt == null, ct))
            {
                throw Problem.Of(ErrorCodes.Conflict, "Already linked.");
            }

            if (b.IsPrimary == true && await db.Links.AnyAsync(l => l.StudentId == b.StudentId && l.IsPrimary && l.RemovedAt == null, ct))
            {
                throw Problem.Of(ErrorCodes.PrimaryGuardianExists);
            }

            db.Links.Add(new GuardianStudentLink(Guid.CreateVersion7(), tenantId, guardianId, b.StudentId!.Value, b.Relationship!, b.IsPrimary!.Value, clock.UtcNow));
            audit.Write(new AuditEntry(AuditAction.GuardianUpdated, AuditOutcome.Success, "guardian", guardianId.ToString(), "link_added",
                new Dictionary<string, object?> { ["studentId"] = b.StudentId, ["isPrimary"] = b.IsPrimary }));
            await db.SaveChangesAsync(ct);
            return await views.BuildAsync(tenantId, guardian, ct);
        }).RequireTenantPermission(P.SchoolGuardiansWrite, isWrite: true);

        g.MapDelete("/{guardianId:guid}/links/{studentId:guid}", async (Guid guardianId, Guid studentId, GuardiansDbContext db, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            var link = await db.Links.FirstOrDefaultAsync(l => l.GuardianId == guardianId && l.StudentId == studentId && l.RemovedAt == null, ct) ?? throw Problem.NotFound();
            if (link.IsPrimary)
            {
                throw Problem.Of(ErrorCodes.PrimaryGuardianRequired);
            }

            link.Remove(clock.UtcNow);
            audit.Write(new AuditEntry(AuditAction.GuardianUpdated, AuditOutcome.Success, "guardian", guardianId.ToString(), "link_removed",
                new Dictionary<string, object?> { ["studentId"] = studentId }));
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireTenantPermission(P.SchoolGuardiansWrite, isWrite: true);

        g.MapGet("/{guardianId:guid}/devices", async (Guid guardianId, GuardiansDbContext db, IUserDirectory users, CancellationToken ct) =>
        {
            var guardian = await Find(db, guardianId, ct);
            var devices = await users.ActiveDevicesAsync([guardian.UserId], ct);
            var d = devices.GetValueOrDefault(guardian.UserId);
            // Transfers, cooldowns and overrides arrive with Phase 6.
            return new GuardianDeviceInfoDto(d is null ? null : new DeviceSummaryDto(d.DeviceId, d.Platform, d.Model, d.State, d.ActivatedAt, d.LastSeenAt), null, [], [], 2);
        }).RequireTenantPermission(P.SchoolGuardiansRead);

        g.MapPost("/{guardianId:guid}/send-welcome", async (Guid tenantId, Guid guardianId, GuardiansDbContext db, ITenantDirectory tenants, IOtpSender sms, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            var guardian = await Find(db, guardianId, ct);
            var now = clock.UtcNow;
            if (guardian.LastWelcomeSentAt is { } last && last > now.AddHours(-24))
            {
                throw Problem.Of(ErrorCodes.RateLimited, "A welcome message was sent in the last 24 hours.",
                    new Dictionary<string, object?> { ["retryAfterSeconds"] = (int)Math.Ceiling((last.AddHours(24) - now).TotalSeconds) });
            }

            var school = (await tenants.FindAsync(tenantId, ct))?.Name ?? "Your school";
            guardian.LastWelcomeSentAt = now;
            audit.Write(new AuditEntry(AuditAction.GuardianUpdated, AuditOutcome.Success, "guardian", guardianId.ToString(), "welcome_sent"));
            await db.SaveChangesAsync(ct);
            await sms.SendAsync(guardian.Phone, school, "welcome", ct);
            return Results.Accepted();
        }).RequireTenantPermission(P.SchoolGuardiansWrite, isWrite: true);
    }

    private static void MapStateChange(RouteGroupBuilder g, string verb, string permission, string[] from, string action, Action<Guardian, string, DateTimeOffset> apply) =>
        g.MapPost($"/{{guardianId:guid}}/{verb}", async (Guid tenantId, Guid guardianId, GuardianStateChangeRequest b, GuardiansDbContext db, GuardianViews views, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            new Validator().Required("reason", b.Reason).MinLength("reason", b.Reason?.Trim(), 3).MaxLength("reason", b.Reason, 500).MaxLength("note", b.Note, 2000).ThrowIfInvalid();
            var guardian = await Find(db, guardianId, ct);
            if (!from.Contains(guardian.State))
            {
                throw Problem.Of(ErrorCodes.Conflict, $"Guardian is {guardian.State}.", new Dictionary<string, object?> { ["currentState"] = guardian.State });
            }

            apply(guardian, b.Reason!.Trim(), clock.UtcNow);
            audit.Write(new AuditEntry(action, AuditOutcome.Success, "guardian", guardian.Id.ToString(), Data: new Dictionary<string, object?> { ["reason"] = b.Reason, ["note"] = b.Note }));
            await db.SaveChangesAsync(ct);
            return await views.BuildAsync(tenantId, guardian, ct);
        }).RequireTenantPermission(permission, isWrite: true);

    private static void ValidateLinks(IReadOnlyList<GuardianLinkInput> links)
    {
        var v = new Validator();
        for (var i = 0; i < links.Count; i++)
        {
            v.Required($"links[{i}].studentId", links[i].StudentId)
             .Required($"links[{i}].relationship", links[i].Relationship).OneOf($"links[{i}].relationship", links[i].Relationship, Relationship.All)
             .Required($"links[{i}].isPrimary", links[i].IsPrimary);
        }

        v.ThrowIfInvalid();
    }

    private static async Task<Guardian> Find(GuardiansDbContext db, Guid id, CancellationToken ct) =>
        await db.Guardians.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw Problem.NotFound();

    private static string ETag(Guardian g) => $"\"{Math.Max(g.UpdatedAt.UtcTicks, g.CreatedAt.UtcTicks).ToString(CultureInfo.InvariantCulture)}\"";
}
