namespace HomeBell.BuildingBlocks.Application;

/// <summary>Claims carried by an access token (docs/architecture/03-identity-auth-otp-devices.md §2).</summary>
public sealed record AccessTokenClaims(
    Guid UserId,
    Guid SessionId,
    string Kind,
    string Scope,
    string DisplayName,
    Guid? DeviceId = null,
    IReadOnlyCollection<string>? PlatformRoles = null,
    Guid? SupportTenantId = null);

public interface IAccessTokenIssuer
{
    (string Token, DateTimeOffset ExpiresAt) Issue(AccessTokenClaims claims);
}

/// <summary>
/// Revoked session ids, checked on every authenticated request. Backed by Redis with a TTL equal to the
/// access-token lifetime so revocation takes effect within seconds on every instance.
/// </summary>
public interface ISessionRevocationList
{
    Task RevokeAsync(Guid sessionId, CancellationToken cancellationToken);

    Task<bool> IsRevokedAsync(Guid sessionId, CancellationToken cancellationToken);
}

/// <summary>Staff tenant access resolved server-side (memberships are never trusted from the token).</summary>
public sealed record TenantAccess(
    Guid TenantId,
    string Role,
    IReadOnlyCollection<string> Permissions,
    string TenantState,
    string OperationalMode,
    bool ReadOnlySupport = false);

/// <summary>Implemented by the Schools module: resolves a staff user's access to one tenant.</summary>
public interface ITenantAccessResolver
{
    /// <returns>Null when the user has no active access (callers return 404 to avoid tenant enumeration).</returns>
    Task<TenantAccess?> ResolveAsync(ICurrentActor actor, Guid tenantId, CancellationToken cancellationToken);
}
