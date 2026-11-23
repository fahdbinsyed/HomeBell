using HomeBell.BuildingBlocks.Domain;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Guardians.Domain;

/// <summary>
/// Per-tenant guardian profile of a global UserAccount (ADR-0006). School A can block its profile without
/// affecting School B. Tenant-owned (RLS).
/// </summary>
public sealed class Guardian : AggregateRoot, ITenantOwned
{
    private Guardian()
        : base(Guid.Empty)
    {
    }

    public Guardian(Guid id, Guid tenantId, Guid userId, string kind, string fullName, string phone, DateTimeOffset createdAt)
        : base(id)
    {
        TenantId = tenantId;
        UserId = userId;
        Kind = kind;
        FullName = fullName;
        Phone = phone;
        CreatedAt = createdAt;
        State = GuardianState.PendingActivation;
    }

    public Guid TenantId { get; private set; }

    public Guid UserId { get; private set; }

    /// <summary>Contract GuardianKind (primary|additional).</summary>
    public string Kind { get; private set; } = GuardianKind.Primary;

    public string FullName { get; private set; } = string.Empty;

    /// <summary>E.164.</summary>
    public string Phone { get; private set; } = string.Empty;

    /// <summary>Contract GuardianState.</summary>
    public string State { get; private set; } = GuardianState.PendingActivation;

    public DateTimeOffset? ActivatedAt { get; private set; }

    public DateTimeOffset? ValidUntil { get; set; }

    public string? BlockedReason { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Additional guardians activate only through invitation redemption (Phase 5), never via login OTP.</summary>
    public bool ActivatesOnLogin => State == GuardianState.PendingActivation && Kind == GuardianKind.Primary;

    public void Activate(DateTimeOffset at)
    {
        if (State != GuardianState.PendingActivation)
        {
            return;
        }

        State = GuardianState.Active;
        ActivatedAt = at;
    }

    public void Block(string reason)
    {
        State = GuardianState.Blocked;
        BlockedReason = reason;
    }

    public void Deactivate() => State = GuardianState.Deactivated;

    public void Reactivate()
    {
        State = ActivatedAt is null ? GuardianState.PendingActivation : GuardianState.Active;
        BlockedReason = null;
    }
}
