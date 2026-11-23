using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Audit.Infrastructure;

/// <summary>Owns the append-only audit.audit_log table (07-audit-outbox-workers §1). Query endpoints arrive in 2b/2c.</summary>
public sealed class AuditModule : IModule
{
    public string Name => "Audit";

    public string Schema => AuditDbContext.SchemaName;

    public void Register(IServiceCollection services, IConfiguration configuration) =>
        services.AddModuleDbContext<AuditDbContext>(Schema, (o, d) => new AuditDbContext(o, d));

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}

public sealed class AuditDbContext(DbContextOptions<AuditDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "audit";

    public override string Schema => SchemaName;

    protected override bool OwnsAuditTable => true;

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
    }
}

internal sealed class AuditDesignTimeFactory : IDesignTimeDbContextFactory<AuditDbContext>
{
    public AuditDbContext CreateDbContext(string[] args) => new(DesignTime.Options<AuditDbContext>(AuditDbContext.SchemaName), null);
}
