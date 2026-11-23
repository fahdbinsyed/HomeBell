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
