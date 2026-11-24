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

    public string? StateReason { get; private set; }

    public DateTimeOffset? StateChangedAt { get; private set; }

    public DateTimeOffset? ActivatedAt { get; private set; }

    public DateTimeOffset? LastActiveAt { get; set; }

    public DateTimeOffset? ValidUntil { get; set; }

    public DateTimeOffset? LastWelcomeSentAt { get; set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Kept for 2a callers; same as <see cref="StateReason"/> when blocked.</summary>
    public string? BlockedReason => State == GuardianState.Blocked ? StateReason : null;

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
        UpdatedAt = at;
    }

    public void Block(string reason, DateTimeOffset? at = null) => SetState(GuardianState.Blocked, reason, at ?? DateTimeOffset.UtcNow);

    public void Deactivate(string reason, DateTimeOffset at) => SetState(GuardianState.Deactivated, reason, at);

    /// <summary>Back to active, or pending_activation if the guardian never signed in.</summary>
    public void Restore(DateTimeOffset at) => SetState(ActivatedAt is null ? GuardianState.PendingActivation : GuardianState.Active, null, at);

    public void Rename(string fullName, DateTimeOffset at)
    {
        FullName = fullName;
        UpdatedAt = at;
    }

    /// <summary>Changing the number points the profile at the account owning the new phone (ADR-0007 §6).</summary>
    public void ChangePhone(string phone, Guid userId, DateTimeOffset at)
    {
        Phone = phone;
        UserId = userId;
        UpdatedAt = at;
    }

    private void SetState(string state, string? reason, DateTimeOffset at)
    {
        State = state;
        StateReason = reason;
        StateChangedAt = at;
        UpdatedAt = at;
    }
}

/// <summary>Guardian ↔ student link. At most one active primary link per student.</summary>
public sealed class GuardianStudentLink : Entity, ITenantOwned
{
    private GuardianStudentLink()
        : base(Guid.Empty)
    {
    }

    public GuardianStudentLink(Guid id, Guid tenantId, Guid guardianId, Guid studentId, string relationship, bool isPrimary, DateTimeOffset createdAt)
        : base(id)
    {
        TenantId = tenantId;
        GuardianId = guardianId;
        StudentId = studentId;
        Relationship = relationship;
        IsPrimary = isPrimary;
        CreatedAt = createdAt;
    }

    public Guid TenantId { get; private set; }

    public Guid GuardianId { get; private set; }

    public Guid StudentId { get; private set; }

    /// <summary>Contract Relationship.</summary>
    public string Relationship { get; private set; } = BuildingBlocks.Domain.Contract.Relationship.Parent;

    public bool IsPrimary { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? RemovedAt { get; private set; }

    public void Remove(DateTimeOffset at) => RemovedAt = at;
}
