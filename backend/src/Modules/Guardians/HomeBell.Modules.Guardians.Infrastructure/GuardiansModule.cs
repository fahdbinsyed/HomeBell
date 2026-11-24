using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.Modules.Guardians.Contracts;
using HomeBell.Modules.Guardians.Domain;
using HomeBell.Modules.Identity.Contracts;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Guardians.Infrastructure;

/// <summary>Composition entry point of the Guardians module (tenant plane).</summary>
public sealed class GuardiansModule : IModule
{
    public string Name => "Guardians";

    public string Schema => GuardiansDbContext.SchemaName;

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
        services.AddModuleDbContext<GuardiansDbContext>(Schema, (o, d) => new GuardiansDbContext(o, d));
        services.AddScoped<IGuardianProfileDirectory, GuardianProfileDirectory>();
        services.AddScoped<IGuardianStats, GuardianStats>();
        services.AddScoped<GuardianLinks>();
        services.AddScoped<IGuardianLinks>(sp => sp.GetRequiredService<GuardianLinks>());
        services.AddScoped<GuardianViews>();
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        GuardianEndpoints.Map(endpoints);
        MeEndpoints.Map(endpoints);
    }
}

public sealed class GuardiansDbContext(DbContextOptions<GuardiansDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "guardians";

    public override string Schema => SchemaName;

    public DbSet<Guardian> Guardians => Set<Guardian>();

    public DbSet<GuardianStudentLink> Links => Set<GuardianStudentLink>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Guardian>(e =>
        {
            e.ToTable("guardian");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.UserId);
            e.HasIndex(x => new { x.TenantId, x.Phone });
            e.HasIndex(x => new { x.TenantId, x.UserId }).IsUnique();
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.State).HasMaxLength(24);
            e.Property(x => x.FullName).HasMaxLength(120);
            e.Property(x => x.Phone).HasMaxLength(16);
            e.Property(x => x.StateReason).HasMaxLength(500);
            e.Ignore(x => x.ActivatesOnLogin);
            e.Ignore(x => x.BlockedReason);
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<GuardianStudentLink>(e =>
        {
            e.ToTable("guardian_student_link");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.StudentId });
            e.HasIndex(x => new { x.TenantId, x.GuardianId });
            // At most one active primary guardian per student.
            e.HasIndex(x => new { x.TenantId, x.StudentId }, "ux_link_one_primary").IsUnique().HasFilter("is_primary AND removed_at IS NULL");
            e.Property(x => x.Relationship).HasMaxLength(24);
        });
    }
}

internal sealed class GuardianProfileDirectory(GuardiansDbContext db, ITenantContext tenant, IClock clock) : IGuardianProfileDirectory
{
    public async Task<IReadOnlyList<GuardianProfileInfo>> ForUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        using var _ = tenant.CrossTenant("guardian profiles of the caller");
        return await db.Guardians.AsNoTracking()
            .Where(g => g.UserId == userId && !(g.Kind == GuardianKind.Additional && g.State == GuardianState.PendingActivation))
            .OrderBy(g => g.CreatedAt)
            .Select(g => new GuardianProfileInfo(g.Id, g.TenantId, g.UserId, g.Kind, g.State, g.ValidUntil))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<GuardianProfileInfo>> ActivatePendingAsync(Guid userId, CancellationToken cancellationToken)
    {
        using var _ = tenant.CrossTenant("activate the caller's pending guardian profiles (ADR-0007)");
        var pending = await db.Guardians
            .Where(g => g.UserId == userId && g.State == GuardianState.PendingActivation && g.Kind == GuardianKind.Primary)
            .ToListAsync(cancellationToken);
        if (pending.Count == 0)
        {
            return [];
        }

        var now = clock.UtcNow;
        foreach (var g in pending)
        {
            g.Activate(now);
        }

        await db.SaveChangesAsync(cancellationToken);
        return pending.Select(g => new GuardianProfileInfo(g.Id, g.TenantId, g.UserId, g.Kind, g.State, g.ValidUntil)).ToList();
    }
}

internal sealed class GuardianStats(GuardiansDbContext db, ITenantContext tenant) : IGuardianStats
{
    public async Task<GuardianCounts> CountsAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        var rows = await db.Guardians.AsNoTracking()
            .GroupBy(g => new { g.Kind, g.State })
            .Select(g => new { g.Key.Kind, g.Key.State, Count = g.Count() })
            .ToListAsync(cancellationToken);
        int Count(Func<string, string, bool> match) => rows.Where(r => match(r.Kind, r.State)).Sum(r => r.Count);
        return new GuardianCounts(
            Count((k, s) => k == GuardianKind.Primary && s == GuardianState.Active),
            Count((k, s) => k == GuardianKind.Primary && s == GuardianState.PendingActivation),
            Count((k, s) => k == GuardianKind.Additional && s == GuardianState.Active),
            Count((_, s) => s == GuardianState.Blocked),
            Count((_, s) => s == GuardianState.Deactivated));
    }

    public async Task<IReadOnlyDictionary<Guid, int>> ActiveByTenantAsync(CancellationToken cancellationToken)
    {
        using var _ = tenant.CrossTenant("platform tenant list: active guardian counts");
        return await db.Guardians.AsNoTracking()
            .Where(g => g.State == GuardianState.Active)
            .GroupBy(g => g.TenantId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);
    }
}

internal sealed class GuardianLinks(GuardiansDbContext db, ITenantContext tenant, IUserAccounts accounts, IAuditWriter audit, IClock clock) : IGuardianLinks
{
    public async Task<IReadOnlyDictionary<Guid, StudentGuardians>> ForStudentsAsync(Guid tenantId, IReadOnlyCollection<Guid> studentIds, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        var rows = await (from l in db.Links.AsNoTracking()
                          where studentIds.Contains(l.StudentId) && l.RemovedAt == null
                          join g in db.Guardians.AsNoTracking() on l.GuardianId equals g.Id
                          select new { l.StudentId, Info = new GuardianLinkSummaryInfo(g.Id, g.FullName, g.Phone, g.Kind, g.State, l.Relationship, l.IsPrimary) })
            .ToListAsync(cancellationToken);
        return rows.GroupBy(r => r.StudentId).ToDictionary(
            gr => gr.Key,
            gr => new StudentGuardians(gr.Select(x => x.Info).FirstOrDefault(i => i.IsPrimary), gr.Count()));
    }

    public async Task<IReadOnlyList<GuardianLinkSummaryInfo>> ForStudentAsync(Guid tenantId, Guid studentId, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        return await (from l in db.Links.AsNoTracking()
                      where l.StudentId == studentId && l.RemovedAt == null
                      join g in db.Guardians.AsNoTracking() on l.GuardianId equals g.Id
                      orderby l.IsPrimary descending, g.FullName
                      select new GuardianLinkSummaryInfo(g.Id, g.FullName, g.Phone, g.Kind, g.State, l.Relationship, l.IsPrimary))
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> LinkPrimaryAsync(Guid tenantId, Guid studentId, string fullName, string phone, string relationship, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        if (await db.Links.AnyAsync(l => l.StudentId == studentId && l.IsPrimary && l.RemovedAt == null, cancellationToken))
        {
            throw Problem.Of(ErrorCodes.PrimaryGuardianExists);
        }

        var (guardian, created) = await EnsurePrimaryAsync(tenantId, fullName, phone, cancellationToken);
        db.Links.Add(new GuardianStudentLink(Guid.CreateVersion7(), tenantId, guardian.Id, studentId, relationship, true, clock.UtcNow));
        await db.SaveChangesAsync(cancellationToken);
        return created;
    }

    public async Task<bool> HasPrimaryAsync(Guid tenantId, Guid studentId, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        return await db.Links.AnyAsync(l => l.StudentId == studentId && l.IsPrimary && l.RemovedAt == null, cancellationToken);
    }

    public async Task<bool> GuardianExistsAsync(Guid tenantId, string phone, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        return await db.Guardians.AnyAsync(g => g.Phone == phone, cancellationToken);
    }

    /// <summary>
    /// The tenant's guardian for this phone, or a new primary profile for the account owning the phone. A person
    /// already active at another school is active here immediately (they have verified this phone before).
    /// </summary>
    internal async Task<(Guardian Guardian, bool Created)> EnsurePrimaryAsync(Guid tenantId, string fullName, string phone, CancellationToken ct)
    {
        var existing = await db.Guardians.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Phone == phone, ct);
        if (existing is not null)
        {
            return (existing, false);
        }

        var userId = await accounts.EnsureByPhoneAsync(phone, fullName, ct);
        var g = new Guardian(Guid.CreateVersion7(), tenantId, userId, GuardianKind.Primary, fullName, phone, clock.UtcNow);
        bool activeElsewhere;
        using (tenant.CrossTenant("is this person already an active guardian elsewhere"))
        {
            activeElsewhere = await db.Guardians.AnyAsync(x => x.UserId == userId && x.ActivatedAt != null, ct);
        }

        if (activeElsewhere)
        {
            g.Activate(clock.UtcNow);
        }

        db.Guardians.Add(g);
        audit.Write(new AuditEntry(AuditAction.GuardianCreated, AuditOutcome.Success, "guardian", g.Id.ToString(),
            Data: new Dictionary<string, object?> { ["phone"] = Phone.Mask(phone) }, TenantId: tenantId));
        return (g, true);
    }
}

internal sealed class GuardiansDesignTimeFactory : IDesignTimeDbContextFactory<GuardiansDbContext>
{
    public GuardiansDbContext CreateDbContext(string[] args) => new(DesignTime.Options<GuardiansDbContext>(GuardiansDbContext.SchemaName), null);
}
