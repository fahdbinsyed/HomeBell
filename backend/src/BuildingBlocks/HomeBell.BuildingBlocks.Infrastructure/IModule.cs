using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.BuildingBlocks.Infrastructure;

/// <summary>
/// Composition contract implemented by each module's Infrastructure project. Hosts discover modules
/// through <see cref="ModuleCatalog"/>; modules never reference each other's Infrastructure.
/// </summary>
public interface IModule
{
    /// <summary>Module name, e.g. "Dismissal".</summary>
    string Name { get; }

    /// <summary>PostgreSQL schema owned by this module.</summary>
    string Schema { get; }

    void Register(IServiceCollection services, IConfiguration configuration);

    void MapEndpoints(IEndpointRouteBuilder endpoints);
}

public static class ModuleCatalog
{
    public static IServiceCollection AddModules(
        this IServiceCollection services,
        IConfiguration configuration,
        IReadOnlyList<IModule> modules)
    {
        ArgumentNullException.ThrowIfNull(modules);
        var duplicateSchema = modules.GroupBy(m => m.Schema).FirstOrDefault(g => g.Count() > 1);
        if (duplicateSchema is not null)
        {
            throw new InvalidOperationException($"Schema '{duplicateSchema.Key}' is claimed by more than one module.");
        }

        foreach (var module in modules)
        {
            module.Register(services, configuration);
        }

        services.AddSingleton(modules);
        return services;
    }

    public static IEndpointRouteBuilder MapModules(this IEndpointRouteBuilder endpoints, IReadOnlyList<IModule> modules)
    {
        ArgumentNullException.ThrowIfNull(modules);
        foreach (var module in modules)
        {
            module.MapEndpoints(endpoints);
        }

        return endpoints;
    }
}
