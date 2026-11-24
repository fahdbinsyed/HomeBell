using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Identity.Domain;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Modules.Identity.Infrastructure;

public sealed record InvitationTokenRequest(string? Token);

public sealed record StaffInvitationPreviewDto(string Email, string TenantName, string Role, DateTimeOffset ExpiresAt, bool AccountExists);

public sealed record StaffInvitationAcceptRequest(string? Token, string? FullName, string? Password);

/// <summary>
/// Staff invitation preview/accept (auth.staff.invitations.*). A new person sets a password; someone who
/// already has a HomeBell password proves it. Then they are signed in to the school app.
/// </summary>
public sealed class StaffInvitationAuth(
    IdentityDbContext db,
    IStaffInvitationRedemption invitations,
    StaffAuthService auth,
    IPasswordHasher<UserAccount> hasher,
    IAuditWriter audit,
    IUnitOfWork uow,
    IClock clock)
{
    public async Task<StaffInvitationPreviewDto> PreviewAsync(InvitationTokenRequest req, CancellationToken ct)
    {
        new Validator().Required("token", req.Token).ThrowIfInvalid();
        var inv = await invitations.FindUsableAsync(req.Token!, ct) ?? throw Problem.Of(ErrorCodes.StaffInvitationInvalid);
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == inv.Email, ct);
        var hasPassword = user is not null && await db.Credentials.AnyAsync(c => c.UserId == user.Id, ct);
        return new StaffInvitationPreviewDto(inv.Email, inv.TenantName, inv.Role, inv.ExpiresAt, hasPassword);
    }

    public async Task<object> AcceptAsync(StaffInvitationAcceptRequest req, CancellationToken ct)
    {
        new Validator().Required("token", req.Token).MaxLength("fullName", req.FullName, 120).ThrowIfInvalid();
        var inv = await invitations.FindUsableAsync(req.Token!, ct) ?? throw Problem.Of(ErrorCodes.StaffInvitationInvalid);
        var now = clock.UtcNow;

        var user = await uow.ExecuteAsync(async t =>
        {
            var existing = await db.Users.FirstOrDefaultAsync(u => u.Email == inv.Email, t);
            var credential = existing is null ? null : await db.Credentials.FirstOrDefaultAsync(c => c.UserId == existing.Id, t);
            if (credential is not null)
            {
                if (string.IsNullOrEmpty(req.Password) || hasher.VerifyHashedPassword(existing!, credential.PasswordHash, req.Password) == PasswordVerificationResult.Failed)
                {
                    throw Problem.Of(ErrorCodes.InvalidCredentials, "Sign in with your existing HomeBell password.");
                }
            }
            else
            {
                new Validator().Required("password", req.Password).ThrowIfInvalid();
                if (req.Password!.Length is < 12 or > 256)
                {
                    throw Problem.Of(ErrorCodes.PasswordPolicyViolation, "Password must be 12–256 characters.");
                }

                existing ??= AddUser(req.FullName is { Length: > 0 } name ? name.Trim() : inv.FullName, inv.Email, now);
                db.Credentials.Add(new StaffCredential(existing.Id, hasher.HashPassword(existing, req.Password), now));
            }

            await db.SaveChangesAsync(t);
            await invitations.RedeemAsync(inv.InvitationId, existing!.Id, t);
            audit.Write(new AuditEntry(AuditAction.StaffInvited, AuditOutcome.Success, "staff_invitation", inv.InvitationId.ToString(),
                "accepted", new Dictionary<string, object?> { ["role"] = inv.Role }, inv.TenantId, existing.Id, existing.FullName));
            return existing;
        }, ct);

        if (await db.MfaFactors.AnyAsync(f => f.UserId == user.Id && f.ConfirmedAt != null, ct))
        {
            return new StaffLoginMfaRequired(auth.Protect(user.Id, "school", "mfa", out var exp), exp);
        }

        return await uow.ExecuteAsync(t => auth.CompleteAsync(user, "school", t), ct);
    }

    private UserAccount AddUser(string fullName, string email, DateTimeOffset now)
    {
        var u = new UserAccount(Guid.CreateVersion7(), fullName, email, null, now);
        db.Users.Add(u);
        return u;
    }
}

/// <summary>User facts for other modules (staff lists, guardian views).</summary>
internal sealed class UserDirectory(IdentityDbContext db) : IUserDirectory
{
    public async Task<IReadOnlyDictionary<Guid, UserInfo>> GetManyAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken)
    {
        var users = await db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).ToListAsync(cancellationToken);
        var mfa = await db.MfaFactors.AsNoTracking().Where(f => userIds.Contains(f.UserId) && f.ConfirmedAt != null).Select(f => f.UserId).ToListAsync(cancellationToken);
        return users.ToDictionary(u => u.Id, u => new UserInfo(u.Id, u.FullName, u.Email, mfa.Contains(u.Id), u.LastLoginAt));
    }

    public async Task<IReadOnlyDictionary<Guid, ActiveDeviceInfo>> ActiveDevicesAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken) =>
        await db.Devices.AsNoTracking()
            .Where(d => userIds.Contains(d.UserId) && d.State == DeviceState.Active)
            .ToDictionaryAsync(d => d.UserId, d => new ActiveDeviceInfo(d.Id, d.Platform, d.Model, d.State, d.ActivatedAt, d.LastSeenAt), cancellationToken);
}
