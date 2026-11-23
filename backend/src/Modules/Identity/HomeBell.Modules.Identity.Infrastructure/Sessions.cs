using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.Modules.Guardians.Contracts;
using HomeBell.Modules.Identity.Domain;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Modules.Identity.Infrastructure;

public sealed class TermsOptions
{
    public string CurrentVersion { get; set; } = "2026-08";
}

/// <summary>Session lifetimes (03-identity §2).</summary>
internal static class SessionLifetimes
{
    public static (TimeSpan Absolute, TimeSpan? Sliding) For(string kind) => kind switch
    {
        SessionKind.Staff => (TimeSpan.FromDays(7), TimeSpan.FromHours(12)),
        SessionKind.Platform => (TimeSpan.FromHours(8), null),
        SessionKind.Guardian => (TimeSpan.FromDays(365), TimeSpan.FromDays(60)),
        SessionKind.Support => (TimeSpan.FromMinutes(30), null),
        _ => (TimeSpan.FromHours(1), null),
    };
}

/// <summary>Issues, rotates and revokes sessions. Callers run inside the request's unit of work.</summary>
public sealed class SessionService(
    IdentityDbContext db,
    IAccessTokenIssuer issuer,
    ISessionRevocationList revocations,
    IAuditWriter audit,
    IClock clock)
{
    public async Task<(Session Session, TokenPairDto Tokens)> IssueAsync(
        UserAccount user,
        string kind,
        string scope,
        Guid? deviceInstallId,
        CancellationToken ct,
        Guid? supportTenantId = null,
        TimeSpan? absoluteOverride = null)
    {
        ArgumentNullException.ThrowIfNull(user);
        var now = clock.UtcNow;
        var (absolute, sliding) = SessionLifetimes.For(kind);
        var session = new Session(Guid.CreateVersion7(), user.Id, kind, scope, deviceInstallId, now, now + (absoluteOverride ?? absolute), sliding, supportTenantId);
        db.Sessions.Add(session);
        var refresh = IdentityCrypto.NewToken();
        db.RefreshTokens.Add(new RefreshToken(Guid.CreateVersion7(), session.Id, IdentityCrypto.Sha256(refresh), now));
        var roles = kind == SessionKind.Platform ? await PlatformRolesAsync(user.Id, ct) : [];
        await db.SaveChangesAsync(ct);
        return (session, Tokens(user, session, refresh, roles));
    }

    /// <summary>Rotates the refresh token. Reuse of a rotated token revokes the session.</summary>
    public async Task<(Session Session, TokenPairDto Tokens)> RefreshAsync(string refreshToken, Guid? deviceHeader, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var hash = IdentityCrypto.Sha256(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(r => r.TokenHash == hash, ct)
            ?? throw Problem.Of(ErrorCodes.RefreshTokenInvalid);
        var session = await db.Sessions.FirstAsync(s => s.Id == stored.SessionId, ct);

        if (stored.RotatedAt is not null)
        {
            if (session.RevokedAt is null)
            {
                session.Revoke(SessionRevokeReason.RefreshReuse, now);
                audit.Write(new AuditEntry(AuditAction.SessionRevoked, AuditOutcome.Success, "session", session.Id.ToString(), SessionRevokeReason.RefreshReuse, ActorIdOverride: session.UserId));
                await db.SaveChangesAsync(ct);
                await revocations.RevokeAsync(session.Id, ct);
            }

            throw Problem.Of(ErrorCodes.RefreshTokenReused);
        }

        if (session.RevokedAt is not null)
        {
            throw Problem.Of(ErrorCodes.SessionRevoked, meta: new Dictionary<string, object?> { ["reason"] = session.RevokeReason });
        }

        if (!session.IsActive(now))
        {
            throw Problem.Of(ErrorCodes.RefreshTokenInvalid, "Session expired.");
        }

        if (session.Kind == SessionKind.Guardian && deviceHeader is { } device && session.DeviceId != device)
        {
            throw Problem.Of(ErrorCodes.DeviceMismatch);
        }

        var user = await db.Users.FirstAsync(u => u.Id == session.UserId, ct);
        if (user.IsDeactivated)
        {
            throw Problem.Of(ErrorCodes.AccountDeactivated);
        }

        stored.MarkRotated(now);
        session.Touch(now);
        var next = IdentityCrypto.NewToken();
        db.RefreshTokens.Add(new RefreshToken(Guid.CreateVersion7(), session.Id, IdentityCrypto.Sha256(next), now));
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Two concurrent refreshes with the same token: the other one won. Not treated as theft.
            throw Problem.Of(ErrorCodes.RefreshTokenInvalid, "Refresh token was just used by another request.");
        }

        var roles = session.Kind == SessionKind.Platform ? await PlatformRolesAsync(user.Id, ct) : [];
        return (session, Tokens(user, session, next, roles));
    }

    public async Task RevokeAsync(Session session, string reason, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(session);
        session.Revoke(reason, clock.UtcNow);
        audit.Write(new AuditEntry(AuditAction.SessionRevoked, AuditOutcome.Success, "session", session.Id.ToString(), reason));
        await db.SaveChangesAsync(ct);
        await revocations.RevokeAsync(session.Id, ct);
    }

    /// <summary>Revokes every active session of a user (password reset, account deactivation).</summary>
    public async Task RevokeAllAsync(Guid userId, string reason, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var active = await db.Sessions.Where(s => s.UserId == userId && s.RevokedAt == null).ToListAsync(ct);
        foreach (var s in active)
        {
            s.Revoke(reason, now);
        }

        await db.SaveChangesAsync(ct);
        foreach (var s in active)
        {
            await revocations.RevokeAsync(s.Id, ct);
        }
    }

    public async Task<IReadOnlyList<string>> PlatformRolesAsync(Guid userId, CancellationToken ct) =>
        await db.PlatformRoles.AsNoTracking().Where(r => r.UserId == userId).Select(r => r.Role).ToListAsync(ct);

    private TokenPairDto Tokens(UserAccount user, Session session, string refresh, IReadOnlyCollection<string> roles)
    {
        var (access, accessExpires) = issuer.Issue(new AccessTokenClaims(
            user.Id, session.Id, session.Kind, session.Scope, user.FullName, session.DeviceId, roles, session.SupportTenantId));
        return new TokenPairDto(access, accessExpires, refresh, session.ExpiresAt, session.Id, session.Scope);
    }
}

/// <summary>Builds the contract <c>Me</c> document from Identity plus other modules' Contracts.</summary>
public sealed class MeBuilder(
    IdentityDbContext db,
    IMembershipDirectory memberships,
    IGuardianProfileDirectory guardians,
    ITenantDirectory tenants,
    TermsOptions terms)
{
    public async Task<MeDto> BuildAsync(UserAccount user, Session session, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(user);
        ArgumentNullException.ThrowIfNull(session);
        var roles = await db.PlatformRoles.AsNoTracking().Where(r => r.UserId == user.Id).Select(r => r.Role).ToListAsync(ct);
        var staff = session.Kind is SessionKind.Staff or SessionKind.Platform ? await memberships.ActiveForUserAsync(user.Id, ct) : [];
        var profiles = session.Kind == SessionKind.Guardian ? await guardians.ForUserAsync(user.Id, ct) : [];
        var tenantInfo = await tenants.GetManyAsync(staff.Select(m => m.TenantId).Concat(profiles.Select(p => p.TenantId)).Distinct().ToList(), ct);

        return new MeDto(
            user.Id,
            user.FullName,
            user.Email,
            user.Phone is null ? null : Phone.Mask(user.Phone),
            user.Locale,
            new MeSessionDto(session.Id, session.Kind, session.Scope, session.DeviceId, session.SupportTenantId),
            roles,
            RolePermissions.ForPlatformRoles(roles),
            staff.Where(m => tenantInfo.ContainsKey(m.TenantId)).Select(m =>
            {
                var t = tenantInfo[m.TenantId];
                return new TenantMembershipSummaryDto(m.MembershipId, m.TenantId, t.Name, t.Slug, m.Role, RolePermissions.ForSchoolRole(m.Role), t.State, t.OperationalMode, t.Timezone);
            }).ToList(),
            profiles.Where(p => tenantInfo.ContainsKey(p.TenantId)).Select(p => ToSummary(p, tenantInfo[p.TenantId])).ToList(),
            session.Kind == SessionKind.Guardian && user.TermsVersion != terms.CurrentVersion,
            terms.CurrentVersion);
    }

    public async Task<IReadOnlyList<GuardianProfileSummaryDto>> SummariesAsync(IReadOnlyList<GuardianProfileInfo> profiles, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(profiles);
        var info = await tenants.GetManyAsync(profiles.Select(p => p.TenantId).Distinct().ToList(), ct);
        return profiles.Where(p => info.ContainsKey(p.TenantId)).Select(p => ToSummary(p, info[p.TenantId])).ToList();
    }

    private static GuardianProfileSummaryDto ToSummary(GuardianProfileInfo p, TenantInfo t) =>
        new(p.GuardianId, p.TenantId, t.Name, p.Kind, p.State, t.OperationalMode, p.ValidUntil);
}
