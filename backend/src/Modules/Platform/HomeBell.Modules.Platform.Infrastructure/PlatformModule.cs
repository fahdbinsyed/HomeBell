using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Platform.Infrastructure;

/// <summary>Composition entry point of the Platform module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class PlatformModule : IModule
{
    public string Name => "Platform";

    public string Schema => "platform";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
