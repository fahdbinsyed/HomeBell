using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Schools.Infrastructure;

/// <summary>Composition entry point of the Schools module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class SchoolsModule : IModule
{
    public string Name => "Schools";

    public string Schema => "schools";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
