using HomeBell.BuildingBlocks.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Notifications.Infrastructure;

/// <summary>Composition entry point of the Notifications module (DbContext, repositories, endpoints — from Phase 2).</summary>
public sealed class NotificationsModule : IModule
{
    public string Name => "Notifications";

    public string Schema => "notifications";

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
    }
}
