using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Audit.Infrastructure;

/// <summary>Composition entry point of the Audit module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class AuditModule : IModule
{
    public string Name => "Audit";

    public string Schema => "audit";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
