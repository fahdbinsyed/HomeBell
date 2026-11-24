using System.Security.Cryptography;
using System.Text;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Contracts;
using HomeBell.Modules.Schools.Domain;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Modules.Schools.Infrastructure;

public sealed class SchoolsOptions
{
    /// <summary>Base URL of the school web app (invitation links).</summary>
    public string WebBaseUrl { get; set; } = "http://localhost:3000";

    public int StaffInvitationDays { get; set; } = 7;
}

internal sealed class SchoolStats(SchoolsDbContext db, ITenantContext tenant) : ISchoolStats
{
    public async Task<int> ActiveStaffAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        return await db.Memberships.CountAsync(m => m.TenantId == tenantId && m.State == MembershipState.Active, cancellationToken);
    }

    public async Task<int> ActiveStudentsAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        using var _ = tenant.Scope(tenantId);
        return await db.Students.CountAsync(s => s.TenantId == tenantId && s.Status == StudentStatus.Active, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, int>> ActiveStudentsByTenantAsync(CancellationToken cancellationToken)
    {
        using var _ = tenant.CrossTenant("platform tenant list: active student counts");
        return await db.Students.AsNoTracking().Where(s => s.Status == StudentStatus.Active)
            .GroupBy(s => s.TenantId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);
    }

    public Task<int> ActiveDisplaysAsync(Guid tenantId, CancellationToken cancellationToken) => Task.FromResult(0);
}

internal sealed class StaffInvitations(
    SchoolsDbContext db,
    ITenantContext tenant,
    ITenantDirectory tenants,
    ICurrentActor actor,
    IEmailSender email,
    IAuditWriter audit,
    IClock clock,
    SchoolsOptions options) : IStaffInvitations
{
    public async Task<StaffInvitationInfo> InviteAsync(Guid tenantId, string emailAddress, string fullName, string role, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(emailAddress);
        var info = await tenants.FindAsync(tenantId, cancellationToken) ?? throw Problem.NotFound();
        var now = clock.UtcNow;
        var key = emailAddress.Trim().ToLowerInvariant();
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        var invitation = new StaffInvitation(Guid.CreateVersion7(), tenantId, key, fullName, role, hash,
            now.AddDays(options.StaffInvitationDays), actor.Id, actor.DisplayName, now);

        using (tenant.Scope(tenantId))
        {
            // A new invitation for the same email replaces any pending one.
            var pending = await db.StaffInvitations
                .Where(i => i.TenantId == tenantId && i.Email == key && i.State == InvitationState.Pending)
                .ToListAsync(cancellationToken);
            pending.ForEach(p => p.Revoke());
            db.StaffInvitations.Add(invitation);
            audit.Write(new AuditEntry(AuditAction.StaffInvited, AuditOutcome.Success, "staff_invitation", invitation.Id.ToString(),
                Data: new Dictionary<string, object?> { ["role"] = role }, TenantId: tenantId));
            await db.SaveChangesAsync(cancellationToken);
        }

        await email.SendAsync(key, $"You're invited to {info.Name} on HomeBell",
            $"Hello {fullName},\n\n{actor.DisplayName} invited you to join {info.Name} on HomeBell.\n" +
            $"Accept within {options.StaffInvitationDays} days:\n{options.WebBaseUrl.TrimEnd('/')}/invite/staff?token={Uri.EscapeDataString(token)}\n",
            cancellationToken);

        return new StaffInvitationInfo(invitation.Id, tenantId, key, fullName, role, invitation.ExpiresAt,
            AuditActorType.User, actor.Id, actor.DisplayName, now);
    }
}
