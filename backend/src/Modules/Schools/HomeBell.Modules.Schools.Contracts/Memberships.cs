namespace HomeBell.Modules.Schools.Contracts;

public sealed record MembershipInfo(Guid MembershipId, Guid TenantId, Guid UserId, string Role, string State);

/// <summary>Staff memberships of a user across tenants (used by Identity for /auth/me and login).</summary>
public interface IMembershipDirectory
{
    Task<IReadOnlyList<MembershipInfo>> ActiveForUserAsync(Guid userId, CancellationToken cancellationToken);
}
