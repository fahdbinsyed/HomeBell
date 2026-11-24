using System.Security.Cryptography;
using System.Text;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Contracts;
using HomeBell.Modules.Schools.Domain;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Schools.Infrastructure;

/// <summary>Composition entry point of the Schools module (tenant plane).</summary>
public sealed class SchoolsModule : IModule
{
    public string Name => "Schools";

    public string Schema => SchoolsDbContext.SchemaName;

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
        services.AddModuleDbContext<SchoolsDbContext>(Schema, (o, d) => new SchoolsDbContext(o, d));
        services.AddScoped<IMembershipDirectory, MembershipDirectory>();
        services.AddScoped<ITenantAccessResolver, StaffTenantAccessResolver>();
        services.AddScoped<TenantAccessHolder>();
        services.AddScoped<ISchoolStats, SchoolStats>();
        services.AddScoped<IStaffInvitations, StaffInvitations>();
        services.AddScoped<IStudentDirectory, StudentDirectory>();
        services.AddScoped<IStaffInvitationRedemption, StaffInvitationRedemption>();
        services.AddScoped<StudentViews>();
        services.AddScoped<ISchoolSettingsReader, SchoolSettingsReader>();
        services.AddSingleton(configuration.GetSection("Schools").Get<SchoolsOptions>() ?? new SchoolsOptions());
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        SchoolEndpoints.Map(endpoints);
        StudentEndpoints.Map(endpoints);
        ImportEndpoints.Map(endpoints);
        StaffEndpoints.Map(endpoints);
    }
}

public sealed class SchoolsDbContext(DbContextOptions<SchoolsDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "schools";

    public override string Schema => SchemaName;

    public DbSet<TenantMembership> Memberships => Set<TenantMembership>();

    public DbSet<StaffInvitation> StaffInvitations => Set<StaffInvitation>();

    public DbSet<SchoolClass> Classes => Set<SchoolClass>();

    public DbSet<Section> Sections => Set<Section>();

    public DbSet<Student> Students => Set<Student>();

    public DbSet<TenantSettingsRecord> Settings => Set<TenantSettingsRecord>();

    public DbSet<ImportJob> Imports => Set<ImportJob>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TenantMembership>(e =>
        {
            e.ToTable("tenant_membership");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.UserId }).IsUnique();
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Role).HasMaxLength(32);
            e.Property(x => x.State).HasMaxLength(16);
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<StaffInvitation>(e =>
        {
            e.ToTable("staff_invitation");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.Email });
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.FullName).HasMaxLength(120);
            e.Property(x => x.Role).HasMaxLength(32);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.Property(x => x.State).HasMaxLength(16);
            e.Property(x => x.InvitedByName).HasMaxLength(120);
        });
        modelBuilder.Entity<SchoolClass>(e =>
        {
            e.ToTable("school_class");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Name }).IsUnique();
            e.Property(x => x.Name).HasMaxLength(60);
            e.Property(x => x.GradeLevel).HasMaxLength(30);
        });
        modelBuilder.Entity<Section>(e =>
        {
            e.ToTable("section");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.ClassId, x.Name }).IsUnique();
            e.Property(x => x.Name).HasMaxLength(30);
        });
        modelBuilder.Entity<Student>(e =>
        {
            e.ToTable("student");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.ExternalRef }).IsUnique().HasFilter("external_ref IS NOT NULL");
            e.HasIndex(x => new { x.TenantId, x.ClassId });
            e.HasIndex(x => new { x.TenantId, x.LastName, x.FirstName });
            e.Property(x => x.ExternalRef).HasMaxLength(50);
            e.Property(x => x.FirstName).HasMaxLength(120);
            e.Property(x => x.LastName).HasMaxLength(120);
            e.Property(x => x.PreferredName).HasMaxLength(120);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.DismissalEligibility).HasMaxLength(16);
            e.Property(x => x.Notes).HasMaxLength(2000);
            e.Property(x => x.RestrictionsNote).HasMaxLength(2000);
            e.Ignore(x => x.FullName);
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<TenantSettingsRecord>(e =>
        {
            e.ToTable("tenant_settings");
            e.HasKey(x => x.TenantId);
            e.Property(x => x.Json).HasColumnType("jsonb");
        });
        modelBuilder.Entity<ImportJob>(e =>
        {
            e.ToTable("import_job");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.CreatedAt });
            e.Property(x => x.Type).HasMaxLength(32);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.FileName).HasMaxLength(200);
            e.Property(x => x.CreatedByName).HasMaxLength(120);
            e.Property(x => x.FailureReason).HasMaxLength(500);
            e.Property(x => x.SummaryJson).HasColumnType("jsonb");
            e.Property(x => x.RowsJson).HasColumnType("jsonb");
        });
    }
}

internal sealed class MembershipDirectory(SchoolsDbContext db, ITenantContext tenant) : IMembershipDirectory
{
    public async Task<IReadOnlyList<MembershipInfo>> ActiveForUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        // A user's own memberships span tenants by definition.
        using var _ = tenant.CrossTenant("staff memberships of the caller");
        return await db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.State == MembershipState.Active)
            .Select(m => new MembershipInfo(m.Id, m.TenantId, m.UserId, m.Role, m.State))
            .ToListAsync(cancellationToken);
    }
}

/// <summary>
/// Staff: active membership in the path tenant (server-side, never from the token). Support: the
/// support session's tenant, read-only. Anything else → null (404).
/// </summary>
internal sealed class StaffTenantAccessResolver(SchoolsDbContext db, ITenantContext tenant, ITenantDirectory tenants) : ITenantAccessResolver
{
    public async Task<TenantAccess?> ResolveAsync(ICurrentActor actor, Guid tenantId, CancellationToken cancellationToken)
    {
        if (actor.Id is not { } userId)
        {
            return null;
        }

        var info = await tenants.FindAsync(tenantId, cancellationToken);
        if (info is null)
        {
            return null;
        }

        if (actor.SessionKind == SessionKind.Support)
        {
            return actor.SupportTenantId == tenantId
                ? new TenantAccess(tenantId, "support", RolePermissions.ForSupportSession(), info.State, info.OperationalMode, ReadOnlySupport: true)
                : null;
        }

        using var _ = tenant.Scope(tenantId);
        var membership = await db.Memberships.AsNoTracking()
            .FirstOrDefaultAsync(m => m.TenantId == tenantId && m.UserId == userId && m.State == MembershipState.Active, cancellationToken);
        if (membership is null || info.OperationalMode == OperationalMode.Setup)
        {
            // Draft (setup) tenants are configured by the platform only.
            return null;
        }

        return new TenantAccess(tenantId, membership.Role, RolePermissions.ForSchoolRole(membership.Role), info.State, info.OperationalMode);
    }
}

internal sealed class StudentDirectory(SchoolsDbContext db, ITenantContext tenant) : IStudentDirectory
{
    public async Task<IReadOnlyDictionary<Guid, StudentRef>> GetManyAsync(Guid tenantId, IReadOnlyCollection<Guid> studentIds, CancellationToken cancellationToken)
    {
        if (studentIds.Count == 0)
        {
            return new Dictionary<Guid, StudentRef>();
        }

        using var _ = tenant.Scope(tenantId);
        var rows = await (from s in db.Students.AsNoTracking()
                          where studentIds.Contains(s.Id)
                          join c in db.Classes.AsNoTracking() on s.ClassId equals c.Id
                          join sec in db.Sections.AsNoTracking() on s.SectionId equals sec.Id into secs
                          from sec in secs.DefaultIfEmpty()
                          select new { s.Id, s.FirstName, s.PreferredName, s.LastName, s.ClassId, ClassName = c.Name, SectionName = sec == null ? null : sec.Name, s.Status, s.DismissalEligibility })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Id, r => new StudentRef(r.Id, $"{r.PreferredName ?? r.FirstName} {r.LastName}", r.ClassId, r.ClassName, r.Status, r.DismissalEligibility,
            r.FirstName, r.LastName, r.PreferredName, r.SectionName));
    }
}

internal sealed class StaffInvitationRedemption(SchoolsDbContext db, ITenantContext tenant, ITenantDirectory tenants, IClock clock) : IStaffInvitationRedemption
{
    public async Task<StaffInvitationPreviewInfo?> FindUsableAsync(string token, CancellationToken cancellationToken)
    {
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        StaffInvitation? inv;
        using (tenant.CrossTenant("staff invitation lookup by token (the token identifies the tenant)"))
        {
            inv = await db.StaffInvitations.AsNoTracking().FirstOrDefaultAsync(i => i.TokenHash == hash, cancellationToken);
        }

        if (inv is null || !inv.IsUsable(clock.UtcNow))
        {
            return null;
        }

        var t = await tenants.FindAsync(inv.TenantId, cancellationToken);
        return t is null ? null : new StaffInvitationPreviewInfo(inv.Id, inv.TenantId, t.Name, inv.Email, inv.FullName, inv.Role, inv.ExpiresAt);
    }

    public async Task RedeemAsync(Guid invitationId, Guid userId, CancellationToken cancellationToken)
    {
        StaffInvitation inv;
        using (tenant.CrossTenant("staff invitation redemption"))
        {
            inv = await db.StaffInvitations.FirstAsync(i => i.Id == invitationId, cancellationToken);
        }

        using var _ = tenant.Scope(inv.TenantId);
        var now = clock.UtcNow;
        var membership = await db.Memberships.FirstOrDefaultAsync(m => m.TenantId == inv.TenantId && m.UserId == userId, cancellationToken);
        if (membership is null)
        {
            db.Memberships.Add(new TenantMembership(Guid.CreateVersion7(), inv.TenantId, userId, inv.Role, inv.InvitedById, now));
        }
        else
        {
            membership.ChangeRole(inv.Role);
            membership.Reactivate();
        }

        inv.Accept(now);
        await db.SaveChangesAsync(cancellationToken);
    }
}

internal sealed class SchoolsDesignTimeFactory : IDesignTimeDbContextFactory<SchoolsDbContext>
{
    public SchoolsDbContext CreateDbContext(string[] args) => new(DesignTime.Options<SchoolsDbContext>(SchoolsDbContext.SchemaName), null);
}
