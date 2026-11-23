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
