using HomeBell.BuildingBlocks.Domain;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Schools.Domain;

/// <summary>Single-use, 7-day invitation for a staff member (token stored hashed). Tenant-owned.</summary>
public sealed class StaffInvitation : AggregateRoot, ITenantOwned
{
    private StaffInvitation()
        : base(Guid.Empty)
    {
    }

    public StaffInvitation(Guid id, Guid tenantId, string email, string fullName, string role, string tokenHash, DateTimeOffset expiresAt, Guid? invitedById, string invitedByName, DateTimeOffset createdAt)
        : base(id)
    {
        TenantId = tenantId;
        Email = email;
        FullName = fullName;
        Role = role;
        TokenHash = tokenHash;
        ExpiresAt = expiresAt;
        InvitedById = invitedById;
        InvitedByName = invitedByName;
        CreatedAt = createdAt;
        State = InvitationState.Pending;
    }

    public Guid TenantId { get; private set; }

    public string Email { get; private set; } = string.Empty;

    public string FullName { get; private set; } = string.Empty;

    /// <summary>Contract SchoolRole.</summary>
    public string Role { get; private set; } = SchoolRole.SchoolFrontDesk;

    public string TokenHash { get; private set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; private set; }

    /// <summary>Contract InvitationState.</summary>
    public string State { get; private set; } = InvitationState.Pending;

    public Guid? InvitedById { get; private set; }

    public string InvitedByName { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? AcceptedAt { get; private set; }

    public bool IsUsable(DateTimeOffset now) => State == InvitationState.Pending && ExpiresAt > now;

    public void Accept(DateTimeOffset at)
    {
        State = InvitationState.Redeemed;
        AcceptedAt = at;
    }

    public void Revoke() => State = InvitationState.Revoked;
}
