using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Guardians.Domain;

/// <summary>
/// Can this guardian request pickup for this child right now? Same checks, in the same order, as
/// packages/mocks/src/rules/eligibility.ts and as the pickup-create endpoint (Phase 4) will enforce.
/// </summary>
public static class PickupEligibilityRules
{
    public sealed record Window(DateTimeOffset OpensAt, DateTimeOffset ClosesAt);

    /// <returns>Null when eligible; otherwise the contract ErrorCode the create endpoint would return.</returns>
    public static string? Rejection(string operationalMode, bool queueEntitled, string guardianState, string studentStatus, string studentEligibility, Window? today, DateTimeOffset now)
    {
        if (operationalMode != OperationalMode.Full)
        {
            return ErrorCodes.TenantNotOperational;
        }

        if (!queueEntitled)
        {
            return ErrorCodes.FeatureNotEntitled;
        }

        var guardian = guardianState switch
        {
            GuardianState.Blocked => ErrorCodes.GuardianBlocked,
            GuardianState.Deactivated => ErrorCodes.GuardianDeactivated,
            GuardianState.Revoked => ErrorCodes.GuardianRevoked,
            GuardianState.Expired => ErrorCodes.GuardianAccessExpired,
            GuardianState.PendingActivation => ErrorCodes.Forbidden,
            _ => null,
        };
        if (guardian is not null)
        {
            return guardian;
        }

        if (studentStatus != StudentStatus.Active)
        {
            return ErrorCodes.StudentInactive;
        }

        if (studentEligibility != DismissalEligibility.Eligible)
        {
            return ErrorCodes.StudentNotEligible;
        }

        return today is null || now < today.OpensAt || now > today.ClosesAt ? ErrorCodes.OutsideDismissalWindow : null;
    }
}
