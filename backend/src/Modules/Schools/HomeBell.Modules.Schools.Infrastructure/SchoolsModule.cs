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
        services.AddSingleton(configuration.GetSection("Schools").Get<SchoolsOptions>() ?? new SchoolsOptions());
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}

public sealed class SchoolsDbContext(DbContextOptions<SchoolsDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "schools";

    public override string Schema => SchemaName;

    public DbSet<TenantMembership> Memberships => Set<TenantMembership>();

    public DbSet<StaffInvitation> StaffInvitations => Set<StaffInvitation>();

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
        if (membership is null)
        {
            return null;
        }

        // Draft (setup) tenants are configured by the platform only.
        if (info.OperationalMode == OperationalMode.Setup)
        {
            return null;
        }

        return new TenantAccess(tenantId, membership.Role, RolePermissions.ForSchoolRole(membership.Role), info.State, info.OperationalMode);
    }
}

internal sealed class SchoolsDesignTimeFactory : IDesignTimeDbContextFactory<SchoolsDbContext>
{
    public SchoolsDbContext CreateDbContext(string[] args) => new(DesignTime.Options<SchoolsDbContext>(SchoolsDbContext.SchemaName), null);
}
