using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.Modules.Guardians.Contracts;
using HomeBell.Modules.Guardians.Domain;
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
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}

public sealed class GuardiansDbContext(DbContextOptions<GuardiansDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "guardians";

    public override string Schema => SchemaName;

    public DbSet<Guardian> Guardians => Set<Guardian>();

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
            e.Property(x => x.BlockedReason).HasMaxLength(500);
            e.Ignore(x => x.ActivatesOnLogin);
            e.Property<uint>("xmin").IsRowVersion();
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

internal sealed class GuardiansDesignTimeFactory : IDesignTimeDbContextFactory<GuardiansDbContext>
{
    public GuardiansDbContext CreateDbContext(string[] args) => new(DesignTime.Options<GuardiansDbContext>(GuardiansDbContext.SchemaName), null);
}
