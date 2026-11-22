using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Guardians.Infrastructure;

/// <summary>Composition entry point of the Guardians module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class GuardiansModule : IModule
{
    public string Name => "Guardians";

    public string Schema => "guardians";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
