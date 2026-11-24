using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.BuildingBlocks.Infrastructure.Security;

/// <summary>Resolved tenant access for the current request (set by <see cref="EndpointAuthorization.RequireTenantPermission"/>).</summary>
public sealed class TenantAccessHolder
{
    public TenantAccess? Access { get; set; }
}

/// <summary>
/// Endpoint filters implementing the authorization model (03-identity §5, 02-multitenancy §3):
/// session kind/scope → permission → tenant scope (404 for foreign tenants) → lifecycle gate.
/// </summary>
public static class EndpointAuthorization
{
    /// <summary>Requires an authenticated session of one of <paramref name="kinds"/> with full scope (unless allowed).</summary>
    public static TBuilder RequireSession<TBuilder>(this TBuilder builder, string[] kinds, string[]? scopes = null)
        where TBuilder : IEndpointConventionBuilder
    {
        builder.RequireAuthorization();
        builder.AddEndpointFilter(async (ctx, next) =>
        {
            var actor = ctx.HttpContext.RequestServices.GetRequiredService<ICurrentActor>();
            if (!actor.IsAuthenticated)
            {
                throw Problem.Unauthenticated();
            }

            if (!kinds.Contains(actor.SessionKind, StringComparer.Ordinal))
            {
                throw Problem.Forbidden("This endpoint is not available for this kind of session.");
            }

            var allowed = scopes ?? [SessionScope.Full];
            if (!allowed.Contains(actor.Scope, StringComparer.Ordinal))
            {
                throw Problem.Of(ErrorCodes.ScopeInsufficient);
            }

            return await next(ctx);
        });
        return builder;
    }

    /// <summary>Platform-plane permission check (platform session + role → permission).</summary>
    public static TBuilder RequirePlatformPermission<TBuilder>(this TBuilder builder, string permission)
        where TBuilder : IEndpointConventionBuilder
    {
        builder.RequireSession([SessionKind.Platform]);
        builder.AddEndpointFilter(async (ctx, next) =>
        {
            var actor = ctx.HttpContext.RequestServices.GetRequiredService<ICurrentActor>();
            if (!RolePermissions.ForPlatformRoles(actor.PlatformRoles).Contains(permission, StringComparer.Ordinal))
            {
                throw Problem.Forbidden();
            }

            // Platform reads span tenants by design; RLS is lifted only for the request's handler.
            using var cross = ctx.HttpContext.RequestServices.GetRequiredService<ITenantContext>().CrossTenant($"platform:{permission}");
            return await next(ctx);
        });
        return builder;
    }

    /// <summary>
    /// Tenant-plane permission check for staff and support sessions on <c>/v1/t/{tenantId}/…</c>.
    /// Unknown or foreign tenants → 404; missing permission → 403; non-operational tenant writes → 409.
    /// </summary>
    public static TBuilder RequireTenantPermission<TBuilder>(this TBuilder builder, string permission, bool isWrite = false)
        where TBuilder : IEndpointConventionBuilder
    {
        builder.RequireSession([SessionKind.Staff, SessionKind.Support], [SessionScope.Full, SessionScope.SupportReadOnly]);
        builder.AddEndpointFilter(async (ctx, next) =>
        {
            var services = ctx.HttpContext.RequestServices;
            var raw = ctx.HttpContext.GetRouteValue("tenantId") as string;
            if (!Guid.TryParse(raw, out var tenantId))
            {
                throw Problem.NotFound();
            }

            var actor = services.GetRequiredService<ICurrentActor>();
            var access = await services.GetRequiredService<ITenantAccessResolver>().ResolveAsync(actor, tenantId, ctx.HttpContext.RequestAborted)
                ?? throw Problem.NotFound();
            if (isWrite && access.ReadOnlySupport)
            {
                throw Problem.Of(ErrorCodes.ScopeInsufficient, "Support sessions are read-only.");
            }

            if (!access.Permissions.Contains(permission, StringComparer.Ordinal))
            {
                throw Problem.Forbidden();
            }

            if (isWrite)
            {

                if (access.OperationalMode is OperationalMode.ReadOnly)
                {
                    throw Problem.Of(ErrorCodes.TenantReadOnly, meta: new Dictionary<string, object?> { ["operationalMode"] = access.OperationalMode });
                }

                if (access.OperationalMode is OperationalMode.Blocked or OperationalMode.ExportOnly)
                {
                    throw Problem.Of(ErrorCodes.TenantNotOperational, meta: new Dictionary<string, object?> { ["operationalMode"] = access.OperationalMode });
                }
            }

            services.GetRequiredService<ITenantContext>().SetTenant(tenantId);
            services.GetRequiredService<TenantAccessHolder>().Access = access;
            return await next(ctx);
        });
        return builder;
    }
}
