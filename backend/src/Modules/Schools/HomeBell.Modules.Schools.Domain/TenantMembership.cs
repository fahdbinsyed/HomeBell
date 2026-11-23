using HomeBell.BuildingBlocks.Domain;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Schools.Domain;

/// <summary>A staff member's role in one tenant (tenant-owned, RLS).</summary>
public sealed class TenantMembership : AggregateRoot, ITenantOwned
{
    private TenantMembership()
        : base(Guid.Empty)
    {
    }

    public TenantMembership(Guid id, Guid tenantId, Guid userId, string role, Guid? invitedBy, DateTimeOffset createdAt)
        : base(id)
    {
        TenantId = tenantId;
        UserId = userId;
        Role = role;
        InvitedBy = invitedBy;
        CreatedAt = createdAt;
        State = MembershipState.Active;
    }

    public Guid TenantId { get; private set; }

    public Guid UserId { get; private set; }

    /// <summary>Contract SchoolRole.</summary>
    public string Role { get; private set; } = SchoolRole.SchoolFrontDesk;

    /// <summary>Contract MembershipState.</summary>
    public string State { get; private set; } = MembershipState.Active;

    public Guid? InvitedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? LastActiveAt { get; set; }

    public void ChangeRole(string role) => Role = role;

    public void Deactivate() => State = MembershipState.Deactivated;

    public void Reactivate() => State = MembershipState.Active;
}
