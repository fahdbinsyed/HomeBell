using System.Globalization;
using System.Text.Json;
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

public sealed record GuardianLinkSummaryDto(Guid GuardianId, string FullName, string MaskedPhone, string Kind, string State, string Relationship, bool IsPrimary)
{
    public static GuardianLinkSummaryDto From(GuardianLinkSummaryInfo g) => new(g.GuardianId, g.FullName, Phone.Mask(g.Phone), g.Kind, g.State, g.Relationship, g.IsPrimary);
}

public sealed record StudentDto(
    Guid Id, string? ExternalRef, string FirstName, string LastName, string? PreferredName, Guid ClassId, string ClassName, Guid? SectionId, string? SectionName,
    string Status, string DismissalEligibility, string? Notes, string? RestrictionsNote, GuardianLinkSummaryDto? PrimaryGuardian, int GuardianCount,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public sealed record NewPrimaryGuardianDto(string? FullName, string? Phone, string? Relationship);

public sealed record CreateStudentRequest(
    string? ExternalRef, string? FirstName, string? LastName, string? PreferredName, Guid? ClassId, Guid? SectionId, string? DismissalEligibility,
    string? Notes, string? RestrictionsNote, NewPrimaryGuardianDto? PrimaryGuardian);

public sealed record NoteRequest(string? Note);

/// <summary>Builds Student views (class/section names, primary guardian, guardian count; restrictions only for writers).</summary>
internal sealed class StudentViews(SchoolsDbContext db, IGuardianLinks links, TenantAccessHolder access)
{
    public bool CanSeeRestrictions => access.Access?.Permissions.Contains(P.SchoolStudentsWrite) == true;

    public async Task<IReadOnlyList<StudentDto>> BuildAsync(Guid tenantId, IReadOnlyList<Student> students, CancellationToken ct)
    {
        var classIds = students.Select(s => s.ClassId).Distinct().ToList();
        var classes = await db.Classes.AsNoTracking().Where(c => classIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var sectionIds = students.Where(s => s.SectionId != null).Select(s => s.SectionId!.Value).Distinct().ToList();
        var sections = await db.Sections.AsNoTracking().Where(s => sectionIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
        var guardians = await links.ForStudentsAsync(tenantId, students.Select(s => s.Id).ToList(), ct);
        return students.Select(s =>
        {
            var g = guardians.GetValueOrDefault(s.Id);
            return new StudentDto(s.Id, s.ExternalRef, s.FirstName, s.LastName, s.PreferredName, s.ClassId, classes.GetValueOrDefault(s.ClassId, "?"),
                s.SectionId, s.SectionId is { } sid ? sections.GetValueOrDefault(sid) : null, s.Status, s.DismissalEligibility, s.Notes,
                CanSeeRestrictions ? s.RestrictionsNote : null, g?.Primary is { } p ? GuardianLinkSummaryDto.From(p) : null, g?.Count ?? 0, s.CreatedAt, s.UpdatedAt);
        }).ToList();
    }

    public async Task<StudentDto> BuildAsync(Guid tenantId, Student s, CancellationToken ct) => (await BuildAsync(tenantId, [s], ct))[0];

    public static string ETag(Student s) => $"\"{s.UpdatedAt.UtcTicks.ToString(CultureInfo.InvariantCulture)}\"";
}

internal static class StudentEndpoints
{
    private const string Base = "/v1/t/{tenantId:guid}/students";

    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var g = endpoints.MapGroup(Base);

        g.MapGet("/", async (Guid tenantId, string? q, Guid? classId, Guid? sectionId, string? status, string? eligibility, int? limit, string? cursor, SchoolsDbContext db, StudentViews views, CancellationToken ct) =>
        {
            new Validator().OneOf("status", status, StudentStatus.All).OneOf("eligibility", eligibility, DismissalEligibility.All).ThrowIfInvalid();
            var query = db.Students.AsNoTracking()
                .Where(s => classId == null || s.ClassId == classId)
                .Where(s => sectionId == null || s.SectionId == sectionId)
                .Where(s => status == null || s.Status == status)
                .Where(s => eligibility == null || s.DismissalEligibility == eligibility);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = $"%{q.Trim()}%";
                query = query.Where(s => EF.Functions.ILike(s.FirstName, term) || EF.Functions.ILike(s.LastName, term) || EF.Functions.ILike(s.PreferredName ?? "", term) || EF.Functions.ILike(s.ExternalRef ?? "", term));
            }

            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var total = await query.CountAsync(ct);
            var rows = await query.OrderBy(s => s.LastName).ThenBy(s => s.FirstName).ThenBy(s => s.Id).Skip(skip).Take(take + 1).ToListAsync(ct);
            return new Page<StudentDto>(await views.BuildAsync(tenantId, rows.Take(take).ToList(), ct), Paging.Next(skip, take, rows.Count), take, total);
        }).RequireTenantPermission(P.SchoolStudentsRead);

        g.MapPost("/", async (Guid tenantId, CreateStudentRequest b, SchoolsDbContext db, IGuardianLinks links, IEntitlements entitlements, StudentViews views, IAuditWriter audit, IUnitOfWork uow, IClock clock, CancellationToken ct) =>
        {
            var pg = b.PrimaryGuardian;
            new Validator()
                .MaxLength("externalRef", b.ExternalRef, 50)
                .Required("firstName", b.FirstName).MaxLength("firstName", b.FirstName, 120)
                .Required("lastName", b.LastName).MaxLength("lastName", b.LastName, 120)
                .MaxLength("preferredName", b.PreferredName, 120)
                .Required("classId", b.ClassId)
                .OneOf("dismissalEligibility", b.DismissalEligibility, DismissalEligibility.All)
                .MaxLength("notes", b.Notes, 2000).MaxLength("restrictionsNote", b.RestrictionsNote, 2000)
                .Required("primaryGuardian", pg)
                .Required("primaryGuardian.fullName", pg?.FullName).MaxLength("primaryGuardian.fullName", pg?.FullName, 120)
                .Required("primaryGuardian.phone", pg?.Phone).Pattern("primaryGuardian.phone", pg?.Phone, Phone.E164(), "Phone must be in international format, e.g. +15551234567.")
                .Required("primaryGuardian.relationship", pg?.Relationship).OneOf("primaryGuardian.relationship", pg?.Relationship, Relationship.All)
                .ThrowIfInvalid();
            await RequireClassAsync(db, b.ClassId!.Value, b.SectionId, ct);

            var student = await uow.ExecuteAsync(async t =>
            {
                await RequireStudentCapacityAsync(db, entitlements, tenantId, t);
                if (b.ExternalRef is { Length: > 0 } ext && await db.Students.AnyAsync(s => s.ExternalRef == ext, t))
                {
                    throw Problem.Of(ErrorCodes.Conflict, "Student number already in use.");
                }

                var now = clock.UtcNow;
                var s = new Student(Guid.CreateVersion7(), tenantId, string.IsNullOrWhiteSpace(b.ExternalRef) ? null : b.ExternalRef.Trim(), b.FirstName!.Trim(), b.LastName!.Trim(),
                    b.PreferredName, b.ClassId!.Value, b.SectionId, b.DismissalEligibility ?? DismissalEligibility.Eligible, b.Notes, b.RestrictionsNote, now);
                db.Students.Add(s);
                audit.Write(new AuditEntry(AuditAction.StudentCreated, AuditOutcome.Success, "student", s.Id.ToString()));
                await db.SaveChangesAsync(t);
                await links.LinkPrimaryAsync(tenantId, s.Id, pg!.FullName!.Trim(), pg.Phone!, pg.Relationship!, t);
                return s;
            }, ct);
            return Results.Json(await views.BuildAsync(tenantId, student, ct), JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        g.MapGet("/{studentId:guid}", async (Guid tenantId, Guid studentId, HttpResponse res, SchoolsDbContext db, StudentViews views, CancellationToken ct) =>
        {
            var s = await FindAsync(db, studentId, ct);
            res.Headers.ETag = StudentViews.ETag(s);
            return await views.BuildAsync(tenantId, s, ct);
        }).RequireTenantPermission(P.SchoolStudentsRead);

        g.MapPatch("/{studentId:guid}", async (Guid tenantId, Guid studentId, HttpRequest req, HttpResponse res, JsonElement b, SchoolsDbContext db, StudentViews views, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            var s = await FindAsync(db, studentId, ct);
            var ifMatch = req.Headers.IfMatch.ToString();
            if (!string.IsNullOrEmpty(ifMatch) && ifMatch != StudentViews.ETag(s))
            {
                throw Problem.Of(ErrorCodes.PreconditionFailed);
            }

            if (b.ValueKind != JsonValueKind.Object || !b.EnumerateObject().Any())
            {
                throw new ApiProblemException(ErrorCodes.ValidationFailed, "Nothing to update.", errors: [new FieldError("body", "min_properties", "Provide at least one field.")]);
            }

            var changed = new List<string>();
            var v = new Validator();
            foreach (var p in b.EnumerateObject())
            {
                string? Str() => p.Value.ValueKind == JsonValueKind.Null ? null : p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : throw Bad(p.Name);
                switch (p.Name)
                {
                    case "externalRef": s.ExternalRef = Str(); v.MaxLength(p.Name, s.ExternalRef, 50); break;
                    case "firstName": s.FirstName = Str()?.Trim() ?? throw Bad(p.Name); v.Required(p.Name, s.FirstName).MaxLength(p.Name, s.FirstName, 120); break;
                    case "lastName": s.LastName = Str()?.Trim() ?? throw Bad(p.Name); v.Required(p.Name, s.LastName).MaxLength(p.Name, s.LastName, 120); break;
                    case "preferredName": s.PreferredName = Str(); v.MaxLength(p.Name, s.PreferredName, 120); break;
                    case "classId": s.ClassId = Guid.TryParse(Str(), out var c) ? c : throw Bad(p.Name); break;
                    case "sectionId": s.SectionId = Str() is { } sec ? Guid.TryParse(sec, out var x) ? x : throw Bad(p.Name) : null; break;
                    case "dismissalEligibility": s.DismissalEligibility = Str() ?? throw Bad(p.Name); v.OneOf(p.Name, s.DismissalEligibility, DismissalEligibility.All); break;
                    case "notes": s.Notes = Str(); v.MaxLength(p.Name, s.Notes, 2000); break;
                    case "restrictionsNote": s.RestrictionsNote = Str(); v.MaxLength(p.Name, s.RestrictionsNote, 2000); break;
                    default: continue;
                }

                changed.Add(p.Name);
            }

            v.ThrowIfInvalid();
            await RequireClassAsync(db, s.ClassId, s.SectionId, ct);
            if (s.ExternalRef is { Length: > 0 } ext && await db.Students.AnyAsync(o => o.ExternalRef == ext && o.Id != s.Id, ct))
            {
                throw Problem.Of(ErrorCodes.Conflict, "Student number already in use.");
            }

            s.Touch(clock.UtcNow);
            audit.Write(new AuditEntry(AuditAction.StudentUpdated, AuditOutcome.Success, "student", s.Id.ToString(), Data: new Dictionary<string, object?> { ["fields"] = changed }));
            await db.SaveChangesAsync(ct);
            res.Headers.ETag = StudentViews.ETag(s);
            return await views.BuildAsync(tenantId, s, ct);
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        g.MapPost("/{studentId:guid}/deactivate", async (Guid tenantId, Guid studentId, NoteRequest? b, SchoolsDbContext db, StudentViews views, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            var s = await FindAsync(db, studentId, ct);
            s.SetStatus(StudentStatus.Inactive, clock.UtcNow);
            audit.Write(new AuditEntry(AuditAction.StudentDeactivated, AuditOutcome.Success, "student", s.Id.ToString(), Data: new Dictionary<string, object?> { ["note"] = b?.Note }));
            await db.SaveChangesAsync(ct);
            return await views.BuildAsync(tenantId, s, ct);
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        g.MapPost("/{studentId:guid}/reactivate", async (Guid tenantId, Guid studentId, NoteRequest? b, SchoolsDbContext db, IEntitlements entitlements, StudentViews views, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            var s = await FindAsync(db, studentId, ct);
            if (s.Status != StudentStatus.Active)
            {
                await RequireStudentCapacityAsync(db, entitlements, tenantId, ct);
                s.SetStatus(StudentStatus.Active, clock.UtcNow);
                audit.Write(new AuditEntry(AuditAction.StudentUpdated, AuditOutcome.Success, "student", s.Id.ToString(), "reactivated", new Dictionary<string, object?> { ["note"] = b?.Note }));
                await db.SaveChangesAsync(ct);
            }

            return await views.BuildAsync(tenantId, s, ct);
        }).RequireTenantPermission(P.SchoolStudentsWrite, isWrite: true);

        g.MapGet("/{studentId:guid}/guardians", async (Guid tenantId, Guid studentId, SchoolsDbContext db, IGuardianLinks links, CancellationToken ct) =>
        {
            await FindAsync(db, studentId, ct);
            return new { items = (await links.ForStudentAsync(tenantId, studentId, ct)).Select(GuardianLinkSummaryDto.From).ToList() };
        }).RequireTenantPermission(P.SchoolStudentsRead);
    }

    internal static async Task RequireStudentCapacityAsync(SchoolsDbContext db, IEntitlements entitlements, Guid tenantId, CancellationToken ct, int adding = 1)
    {
        var limit = (await entitlements.ResolveAsync(tenantId, ct)).Limits.First(l => l.Key == LimitKey.StudentsMax);
        var used = await db.Students.CountAsync(s => s.Status == StudentStatus.Active, ct);
        if (limit.Value is { } max && used + adding > max)
        {
            throw Problem.Of(ErrorCodes.LimitExceeded, meta: new Dictionary<string, object?> { ["limit"] = LimitKey.StudentsMax, ["value"] = max, ["used"] = used });
        }
    }

    internal static async Task RequireClassAsync(SchoolsDbContext db, Guid classId, Guid? sectionId, CancellationToken ct)
    {
        var v = new Validator()
            .Must(await db.Classes.AnyAsync(c => c.Id == classId, ct), "classId", "invalid_value", "Choose a class.");
        if (sectionId is { } sid)
        {
            v.Must(await db.Sections.AnyAsync(s => s.Id == sid && s.ClassId == classId, ct), "sectionId", "invalid_value", "Section does not belong to the class.");
        }

        v.ThrowIfInvalid();
    }

    private static async Task<Student> FindAsync(SchoolsDbContext db, Guid id, CancellationToken ct) =>
        await db.Students.FirstOrDefaultAsync(s => s.Id == id, ct) ?? throw Problem.NotFound();

    private static ApiProblemException Bad(string field) =>
        new(ErrorCodes.ValidationFailed, "One or more fields are invalid.", errors: [new FieldError(field, "invalid_value", $"{field} has an invalid value.")]);
}
