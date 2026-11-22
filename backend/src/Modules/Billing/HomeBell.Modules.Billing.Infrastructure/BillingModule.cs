using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Billing.Infrastructure;

/// <summary>Composition entry point of the Billing module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class BillingModule : IModule
{
    public string Name => "Billing";

    public string Schema => "billing";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
