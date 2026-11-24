namespace HomeBell.Modules.Schools.Contracts;

public sealed record MembershipInfo(Guid MembershipId, Guid TenantId, Guid UserId, string Role, string State);

/// <summary>Staff memberships of a user across tenants (used by Identity for /auth/me and login).</summary>
public interface IMembershipDirectory
{
    Task<IReadOnlyList<MembershipInfo>> ActiveForUserAsync(Guid userId, CancellationToken cancellationToken);
}

/// <summary>Counts the platform shows for a tenant (usage, tenant list).</summary>
public interface ISchoolStats
{
    Task<int> ActiveStaffAsync(Guid tenantId, CancellationToken cancellationToken);

    /// <summary>Active students (students arrive in Phase 2c; 0 until then).</summary>
    Task<int> ActiveStudentsAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<IReadOnlyDictionary<Guid, int>> ActiveStudentsByTenantAsync(CancellationToken cancellationToken);

    /// <summary>Active display screens (displays arrive in Phase 4; 0 until then).</summary>
    Task<int> ActiveDisplaysAsync(Guid tenantId, CancellationToken cancellationToken);
}

public sealed record StaffInvitationInfo(
    Guid Id, Guid TenantId, string Email, string FullName, string Role, DateTimeOffset ExpiresAt,
    string InvitedByType, Guid? InvitedById, string InvitedByName, DateTimeOffset CreatedAt);

/// <summary>Creates staff invitations (school admins invite staff; the platform invites the first school admin).</summary>
public interface IStaffInvitations
{
    /// <summary>Creates a 7-day, single-use invitation and emails the link. Runs in the caller's unit of work.</summary>
    Task<StaffInvitationInfo> InviteAsync(Guid tenantId, string email, string fullName, string role, CancellationToken cancellationToken);
}

public sealed record StudentRef(Guid Id, string FullName, Guid ClassId, string ClassName, string Status, string DismissalEligibility);

/// <summary>Student names/classes for other modules (guardian views, later pickups).</summary>
public interface IStudentDirectory
{
    Task<IReadOnlyDictionary<Guid, StudentRef>> GetManyAsync(Guid tenantId, IReadOnlyCollection<Guid> studentIds, CancellationToken cancellationToken);
}

public sealed record StaffInvitationPreviewInfo(Guid InvitationId, Guid TenantId, string TenantName, string Email, string FullName, string Role, DateTimeOffset ExpiresAt);

/// <summary>Staff invitation redemption (Identity owns the sign-in; Schools owns the membership).</summary>
public interface IStaffInvitationRedemption
{
    /// <returns>Null when the token is unknown, expired, revoked or already used.</returns>
    Task<StaffInvitationPreviewInfo?> FindUsableAsync(string token, CancellationToken cancellationToken);

    /// <summary>Creates (or reactivates) the membership and marks the invitation redeemed, in the caller's unit of work.</summary>
    Task RedeemAsync(Guid invitationId, Guid userId, CancellationToken cancellationToken);
}
