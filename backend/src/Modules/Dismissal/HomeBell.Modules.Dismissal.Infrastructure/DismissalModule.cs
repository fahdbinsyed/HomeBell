using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Dismissal.Infrastructure;

/// <summary>Composition entry point of the Dismissal module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class DismissalModule : IModule
{
    public string Name => "Dismissal";

    public string Schema => "dismissal";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
