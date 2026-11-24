namespace HomeBell.Modules.Guardians.Contracts;

public sealed record GuardianProfileInfo(Guid GuardianId, Guid TenantId, Guid UserId, string Kind, string State, DateTimeOffset? ValidUntil);

/// <summary>A user's guardian profiles across tenants (Identity uses it for OTP sign-in and /auth/me).</summary>
public interface IGuardianProfileDirectory
{
    /// <summary>Every profile of the user except additional guardians still awaiting invitation redemption.</summary>
    Task<IReadOnlyList<GuardianProfileInfo>> ForUserAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// Activates all pending primary-guardian profiles of the user across tenants (ADR-0007 step 3) and
    /// returns the activated ones. Runs inside the caller's unit of work.
    /// </summary>
    Task<IReadOnlyList<GuardianProfileInfo>> ActivatePendingAsync(Guid userId, CancellationToken cancellationToken);
}

public sealed record GuardianCounts(int PrimaryActive, int PrimaryPending, int AdditionalActive, int Blocked, int Deactivated = 0)
{
    public int Active => PrimaryActive + AdditionalActive;
}

public interface IGuardianStats
{
    Task<GuardianCounts> CountsAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<IReadOnlyDictionary<Guid, int>> ActiveByTenantAsync(CancellationToken cancellationToken);
}

public sealed record GuardianLinkSummaryInfo(Guid GuardianId, string FullName, string Phone, string Kind, string State, string Relationship, bool IsPrimary);

public sealed record StudentGuardians(GuardianLinkSummaryInfo? Primary, int Count);

/// <summary>Guardian ↔ student links, for the Schools module's student views and student creation.</summary>
public interface IGuardianLinks
{
    Task<IReadOnlyDictionary<Guid, StudentGuardians>> ForStudentsAsync(Guid tenantId, IReadOnlyCollection<Guid> studentIds, CancellationToken cancellationToken);

    Task<IReadOnlyList<GuardianLinkSummaryInfo>> ForStudentAsync(Guid tenantId, Guid studentId, CancellationToken cancellationToken);

    /// <summary>
    /// Links the student's primary guardian: matches an existing guardian in the tenant by phone, otherwise
    /// creates the account (by phone) and a pending_activation profile (ADR-0007). Runs in the caller's unit of work.
    /// </summary>
    /// <returns>True when a new guardian profile was created.</returns>
    Task<bool> LinkPrimaryAsync(Guid tenantId, Guid studentId, string fullName, string phone, string relationship, CancellationToken cancellationToken);

    Task<bool> HasPrimaryAsync(Guid tenantId, Guid studentId, CancellationToken cancellationToken);

    Task<bool> GuardianExistsAsync(Guid tenantId, string phone, CancellationToken cancellationToken);
}
