using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Platform.Domain;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Platform.Infrastructure;

/// <summary>Composition entry point of the Platform module (control plane).</summary>
public sealed class PlatformModule : IModule
{
    public string Name => "Platform";

    public string Schema => PlatformDbContext.SchemaName;

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
        services.AddModuleDbContext<PlatformDbContext>(Schema, (o, d) => new PlatformDbContext(o, d));
        services.AddScoped<ITenantDirectory, TenantDirectory>();
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}

public sealed class PlatformDbContext(DbContextOptions<PlatformDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "platform";

    public override string Schema => SchemaName;

    public DbSet<Tenant> Tenants => Set<Tenant>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Tenant>(e =>
        {
            e.ToTable("tenant");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(64);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.LegalName).HasMaxLength(200);
            e.Property(x => x.Region).HasMaxLength(32);
            e.Property(x => x.Timezone).HasMaxLength(64);
            e.Property(x => x.CountryCode).HasMaxLength(2);
            e.Property(x => x.State).HasMaxLength(32);
            e.Property(x => x.PreviousOperationalState).HasMaxLength(32);
            e.Property(x => x.DataPlacement).HasMaxLength(16);
            e.Property(x => x.PlacementKey).HasMaxLength(64);
            e.Ignore(x => x.OperationalMode);
            e.Property<uint>("xmin").IsRowVersion();
        });
    }
}

/// <summary>Tenant records are control-plane data (no RLS); reads are safe for any module.</summary>
internal sealed class TenantDirectory(PlatformDbContext db) : ITenantDirectory
{
    public async Task<TenantInfo?> FindAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var t = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        return t is null ? null : Map(t);
    }

    public async Task<IReadOnlyDictionary<Guid, TenantInfo>> GetManyAsync(IReadOnlyCollection<Guid> tenantIds, CancellationToken cancellationToken)
    {
        if (tenantIds.Count == 0)
        {
            return new Dictionary<Guid, TenantInfo>();
        }

        var list = await db.Tenants.AsNoTracking().Where(x => tenantIds.Contains(x.Id)).ToListAsync(cancellationToken);
        return list.ToDictionary(x => x.Id, Map);
    }

    private static TenantInfo Map(Tenant t) => new(t.Id, t.Name, t.Slug, t.State, t.OperationalMode, t.Timezone);
}

/// <summary>Design-time factory for <c>dotnet ef migrations</c> (no database connection needed).</summary>
internal sealed class PlatformDesignTimeFactory : IDesignTimeDbContextFactory<PlatformDbContext>
{
    public PlatformDbContext CreateDbContext(string[] args) => new(DesignTime.Options<PlatformDbContext>(PlatformDbContext.SchemaName), null);
}
