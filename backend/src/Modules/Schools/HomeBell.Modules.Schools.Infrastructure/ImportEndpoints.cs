using System.Text;
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

public sealed record ImportSummaryDto(int TotalRows, int ValidRows, int WarningRows, int ErrorRows, int StudentsToCreate, int StudentsToUpdate, int GuardiansToCreate, int GuardiansToLink);

public sealed record ImportJobDto(Guid Id, string Type, string Status, string FileName, DateTimeOffset CreatedAt, ActorRefDto CreatedBy, DateTimeOffset? CommittedAt, string? FailureReason, ImportSummaryDto Summary);

public sealed record ImportRowDto(int RowNumber, string Status, Dictionary<string, string?> Data, List<FieldError> Messages);

public sealed record CommitImportRequest(bool? SkipErrorRows);

/// <summary>
/// CSV import of students with their primary guardian (ADR-0007): upload → validate (preview) → commit.
/// Columns: student_external_ref, student_first_name, student_last_name, class, section, guardian_full_name,
/// guardian_phone, guardian_relationship. UTF-8, max 5 MB.
/// </summary>
internal static class ImportEndpoints
{
    private const string Base = "/v1/t/{tenantId:guid}/imports";
    private const long MaxBytes = 5 * 1024 * 1024;

    private static readonly string[] Columns =
        ["student_external_ref", "student_first_name", "student_last_name", "class", "section", "guardian_full_name", "guardian_phone", "guardian_relationship"];

    private static readonly string[] Required =
        ["student_first_name", "student_last_name", "class", "guardian_full_name", "guardian_phone", "guardian_relationship"];

    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var g = endpoints.MapGroup(Base);

        g.MapGet("/template", () => Results.Text(string.Join(',', Columns) + "\nS-1001,Ava,Lee,Grade 1,1A,Mia Lee,+15550123456,mother\n", "text/csv", Encoding.UTF8))
            .RequireTenantPermission(P.SchoolImportsWrite);

        g.MapPost("/", async (Guid tenantId, HttpRequest req, SchoolsDbContext db, IGuardianLinks links, IEntitlements entitlements, ICurrentActor actor, IClock clock, CancellationToken ct) =>
        {
            if (!req.HasFormContentType)
            {
                throw Problem.Of(ErrorCodes.UnsupportedMediaType, "Send multipart/form-data with type and file.");
            }

            if (!await entitlements.HasFeatureAsync(tenantId, FeatureKey.ImportsCsv, ct))
            {
                throw Problem.Of(ErrorCodes.FeatureNotEntitled, meta: new Dictionary<string, object?> { ["feature"] = FeatureKey.ImportsCsv });
            }

            var form = await req.ReadFormAsync(ct);
            new Validator().Required("type", form["type"].ToString()).OneOf("type", form["type"].ToString(), ImportType.All).ThrowIfInvalid();
            var file = form.Files.GetFile("file") ?? throw Problem.Of(ErrorCodes.ImportInvalidFile, "Attach a CSV file.");
            if (file.Length > MaxBytes)
            {
                throw Problem.Of(ErrorCodes.PayloadTooLarge, meta: new Dictionary<string, object?> { ["maxBytes"] = MaxBytes });
            }

            string text;
            using (var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
            {
                text = await reader.ReadToEndAsync(ct);
            }

            var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Trim().Length > 0).ToList();
            if (lines.Count == 0)
            {
                throw Problem.Of(ErrorCodes.ImportInvalidFile, "The file is empty.");
            }

            var header = Csv.Split(lines[0]).Select(h => h.Trim().ToLowerInvariant()).ToList();
            var missing = Required.Where(r => !header.Contains(r)).ToList();
            if (missing.Count > 0)
            {
                throw Problem.Of(ErrorCodes.ImportInvalidFile, $"Missing columns: {string.Join(", ", missing)}");
            }

            var maxRows = (await entitlements.ResolveAsync(tenantId, ct)).Limits.First(l => l.Key == LimitKey.ImportsMaxRows).Value;
            if (maxRows is { } max && lines.Count - 1 > max)
            {
                throw Problem.Of(ErrorCodes.LimitExceeded, meta: new Dictionary<string, object?> { ["limit"] = LimitKey.ImportsMaxRows, ["value"] = max });
            }

            var classes = await db.Classes.AsNoTracking().ToListAsync(ct);
            var existingRefs = (await db.Students.AsNoTracking().Where(s => s.ExternalRef != null).Select(s => s.ExternalRef!).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var rows = new List<ImportRowDto>();
            var (toCreate, toUpdate, gCreate, gLink) = (0, 0, 0, 0);
            var seenPhones = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 1; i < lines.Count; i++)
            {
                var cells = Csv.Split(lines[i]);
                var data = Columns.ToDictionary(c => c, c => header.IndexOf(c) is var k and >= 0 && k < cells.Count && cells[k].Trim().Length > 0 ? cells[k].Trim() : null);
                var messages = Required.Where(r => data[r] is null).Select(r => new FieldError(r, "required", $"{r} is required")).ToList();
                if (data["guardian_phone"] is { } phone && !Phone.E164().IsMatch(phone))
                {
                    messages.Add(new FieldError("guardian_phone", "invalid_format", "Use international format, e.g. +15551234567"));
                }

                if (data["class"] is { } cls && !classes.Any(c => string.Equals(c.Name, cls, StringComparison.OrdinalIgnoreCase)))
                {
                    messages.Add(new FieldError("class", "unknown_class", $"Class \"{cls}\" does not exist"));
                }

                if (data["guardian_relationship"] is { } rel && !Relationship.IsValid(rel.ToLowerInvariant()))
                {
                    messages.Add(new FieldError("guardian_relationship", "invalid_value", $"Use one of: {string.Join(", ", Relationship.All)}"));
                }

                var updates = data["student_external_ref"] is { } ext && existingRefs.Contains(ext);
                var warnings = updates ? new List<FieldError> { new("student_external_ref", "will_update", "Existing student will be updated") } : [];
                if (messages.Count == 0)
                {
                    if (updates)
                    {
                        toUpdate++;
                    }
                    else
                    {
                        toCreate++;
                    }

                    var p = data["guardian_phone"]!;
                    if (seenPhones.Add(p))
                    {
                        if (await links.GuardianExistsAsync(tenantId, p, ct))
                        {
                            gLink++;
                        }
                        else
                        {
                            gCreate++;
                        }
                    }
                }

                rows.Add(new ImportRowDto(i + 1, messages.Count > 0 ? ImportRowStatus.Error : warnings.Count > 0 ? ImportRowStatus.Warning : ImportRowStatus.Valid, data, [.. messages, .. warnings]));
            }

            var summary = new ImportSummaryDto(rows.Count, rows.Count(r => r.Status == ImportRowStatus.Valid), rows.Count(r => r.Status == ImportRowStatus.Warning),
                rows.Count(r => r.Status == ImportRowStatus.Error), toCreate, toUpdate, gCreate, gLink);
            var job = new ImportJob(Guid.CreateVersion7(), tenantId, form["type"].ToString(), Path.GetFileName(file.FileName), actor.Id, actor.DisplayName,
                JsonSerializer.Serialize(summary, JsonDefaults.Options), JsonSerializer.Serialize(rows, JsonDefaults.Options), clock.UtcNow);
            db.Imports.Add(job);
            await db.SaveChangesAsync(ct);
            return Results.Json(Dto(job), JsonDefaults.Options, statusCode: StatusCodes.Status202Accepted);
        }).RequireTenantPermission(P.SchoolImportsWrite, isWrite: true).DisableAntiforgery();

        g.MapGet("/{importId:guid}", async (Guid importId, SchoolsDbContext db, CancellationToken ct) => Dto(await FindAsync(db, importId, ct)))
            .RequireTenantPermission(P.SchoolImportsWrite);

        g.MapGet("/{importId:guid}/rows", async (Guid importId, string? status, int? limit, string? cursor, SchoolsDbContext db, CancellationToken ct) =>
        {
            new Validator().OneOf("status", status, ImportRowStatus.All).ThrowIfInvalid();
            var rows = Rows(await FindAsync(db, importId, ct)).Where(r => status == null || r.Status == status).ToList();
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var page = rows.Skip(skip).Take(take + 1).ToList();
            return new Page<ImportRowDto>(page.Take(take).ToList(), Paging.Next(skip, take, page.Count), take, rows.Count);
        }).RequireTenantPermission(P.SchoolImportsWrite);

        g.MapPost("/{importId:guid}/commit", async (Guid tenantId, Guid importId, CommitImportRequest? b, SchoolsDbContext db, IGuardianLinks links, IEntitlements entitlements, IAuditWriter audit, IUnitOfWork uow, IClock clock, CancellationToken ct) =>
        {
            var job = await FindAsync(db, importId, ct);
            if (job.Status == ImportStatus.Completed)
            {
                throw Problem.Of(ErrorCodes.ImportAlreadyCommitted);
            }

            if (job.Status != ImportStatus.Validated)
            {
                throw Problem.Of(ErrorCodes.ImportNotValidated);
            }

            var rows = Rows(job);
            var errors = rows.Count(r => r.Status == ImportRowStatus.Error);
            if (errors > 0 && b?.SkipErrorRows != true)
            {
                throw Problem.Of(ErrorCodes.ImportHasErrors, $"{errors} rows have errors.");
            }

            await uow.ExecuteAsync(async t =>
            {
                var classes = await db.Classes.ToListAsync(t);
                var sections = await db.Sections.ToListAsync(t);
                var creating = rows.Count(r => r.Status == ImportRowStatus.Valid);
                await StudentEndpoints.RequireStudentCapacityAsync(db, entitlements, tenantId, t, creating);
                var now = clock.UtcNow;
                foreach (var row in rows.Where(r => r.Status != ImportRowStatus.Error))
                {
                    var d = row.Data;
                    var cls = classes.First(c => string.Equals(c.Name, d["class"], StringComparison.OrdinalIgnoreCase));
                    var sec = d["section"] is { } secName ? sections.FirstOrDefault(s => s.ClassId == cls.Id && string.Equals(s.Name, secName, StringComparison.OrdinalIgnoreCase)) : null;
                    if (d["section"] is { } newSec && sec is null)
                    {
                        sec = new Section(Guid.CreateVersion7(), tenantId, cls.Id, newSec);
                        db.Sections.Add(sec);
                        sections.Add(sec);
                    }

                    var ext = d["student_external_ref"];
                    var student = ext is null ? null : await db.Students.FirstOrDefaultAsync(s => s.ExternalRef == ext, t);
                    if (student is null)
                    {
                        student = new Student(Guid.CreateVersion7(), tenantId, ext, d["student_first_name"]!, d["student_last_name"]!, null, cls.Id, sec?.Id, DismissalEligibility.Eligible, null, null, now);
                        db.Students.Add(student);
                    }
                    else
                    {
                        student.FirstName = d["student_first_name"]!;
                        student.LastName = d["student_last_name"]!;
                        student.ClassId = cls.Id;
                        student.SectionId = sec?.Id;
                        student.Touch(now);
                    }

                    await db.SaveChangesAsync(t);
                    if (!await links.HasPrimaryAsync(tenantId, student.Id, t))
                    {
                        await links.LinkPrimaryAsync(tenantId, student.Id, d["guardian_full_name"]!, d["guardian_phone"]!, d["guardian_relationship"]!.ToLowerInvariant(), t);
                    }
                }

                job.Commit(now);
                audit.Write(new AuditEntry(AuditAction.ImportCommitted, AuditOutcome.Success, "import_job", job.Id.ToString(),
                    Data: new Dictionary<string, object?> { ["rows"] = rows.Count, ["skippedErrors"] = errors }));
                await db.SaveChangesAsync(t);
            }, ct);
            return Results.Json(Dto(job), JsonDefaults.Options, statusCode: StatusCodes.Status202Accepted);
        }).RequireTenantPermission(P.SchoolImportsWrite, isWrite: true).RequireIdempotency("schools.imports.commit");
    }

    private static async Task<ImportJob> FindAsync(SchoolsDbContext db, Guid id, CancellationToken ct) =>
        await db.Imports.FirstOrDefaultAsync(j => j.Id == id, ct) ?? throw Problem.NotFound();

    private static List<ImportRowDto> Rows(ImportJob job) => JsonSerializer.Deserialize<List<ImportRowDto>>(job.RowsJson, JsonDefaults.Options) ?? [];

    private static ImportJobDto Dto(ImportJob j) =>
        new(j.Id, j.Type, j.Status, j.FileName, j.CreatedAt, new ActorRefDto(AuditActorType.User, j.CreatedById, j.CreatedByName), j.CommittedAt, j.FailureReason,
            JsonSerializer.Deserialize<ImportSummaryDto>(j.SummaryJson, JsonDefaults.Options)!);
}

/// <summary>Minimal RFC 4180 field splitter (quoted fields, doubled quotes).</summary>
internal static class Csv
{
    public static List<string> Split(string line)
    {
        var fields = new List<string>();
        var sb = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (quoted)
            {
                if (ch == '"' && i + 1 < line.Length && line[i + 1] == '"')
                {
                    sb.Append('"');
                    i++;
                }
                else if (ch == '"')
                {
                    quoted = false;
                }
                else
                {
                    sb.Append(ch);
                }
            }
            else if (ch == '"')
            {
                quoted = true;
            }
            else if (ch == ',')
            {
                fields.Add(sb.ToString());
                sb.Clear();
            }
            else
            {
                sb.Append(ch);
            }
        }

        fields.Add(sb.ToString());
        return fields;
    }
}
