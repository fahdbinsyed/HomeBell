using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Reporting.Infrastructure;

/// <summary>Composition entry point of the Reporting module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class ReportingModule : IModule
{
    public string Name => "Reporting";

    public string Schema => "reporting";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
