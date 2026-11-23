using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Identity.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Modules.Identity.Infrastructure;

public sealed record PlatformUserDto(Guid UserId, string FullName, string Email, IReadOnlyList<string> Roles, string Status, bool MfaEnabled, DateTimeOffset? LastLoginAt);

public sealed record InvitePlatformUserRequest(string? Email, string? FullName, List<string>? Roles);

public sealed record UpdatePlatformUserRequest(List<string>? Roles, string? Status);

/// <summary>Platform users (control-plane staff). Invitations reuse the password-reset link to set a password.</summary>
internal static class PlatformUserEndpoints
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var g = endpoints.MapGroup("/v1/platform");

        g.MapGet("/users", async (int? limit, string? cursor, IdentityDbContext db, CancellationToken ct) =>
        {
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var ids = db.PlatformRoles.Select(r => r.UserId).Distinct();
            var users = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).OrderBy(u => u.FullName).ThenBy(u => u.Id)
                .Skip(skip).Take(take + 1).ToListAsync(ct);
            var page = users.Take(take).ToList();
            var dtos = await ToDtosAsync(db, page, ct);
            return new Page<PlatformUserDto>(dtos, Paging.Next(skip, take, users.Count), take);
        }).RequirePlatformPermission(Permission.PlatformUsersManage);

        g.MapPost("/user-invitations", async (InvitePlatformUserRequest body, IdentityDbContext db, IUnitOfWork uow, IEmailSender email,
            IAuditWriter audit, IClock clock, StaffAuthOptions options, CancellationToken ct) =>
        {
            new Validator()
                .Required("email", body.Email).MaxLength("email", body.Email, 254)
                .Required("fullName", body.FullName).MaxLength("fullName", body.FullName, 120)
                .Must(body.Roles is { Count: > 0 }, "roles", "required", "At least one role is required.")
                .ThrowIfInvalid();
            foreach (var role in body.Roles!)
            {
                new Validator().OneOf("roles", role, PlatformRole.All).ThrowIfInvalid();
            }

            var key = body.Email!.Trim().ToLowerInvariant();
            var token = IdentityCrypto.NewToken();
            var dto = await uow.ExecuteAsync(async t =>
            {
                var user = await db.Users.FirstOrDefaultAsync(u => u.Email == key, t);
                if (user is not null && await db.PlatformRoles.AnyAsync(r => r.UserId == user.Id, t))
                {
                    throw Problem.Of(ErrorCodes.Conflict, "Already a platform user.");
                }

                if (user is null)
                {
                    user = new UserAccount(Guid.CreateVersion7(), body.FullName!, key, null, clock.UtcNow);
                    db.Users.Add(user);
                }

                db.PlatformRoles.AddRange(body.Roles!.Distinct(StringComparer.Ordinal).Select(r => new PlatformRoleAssignment(user.Id, r)));
                db.PasswordResets.Add(new PasswordResetToken(Guid.CreateVersion7(), user.Id, IdentityCrypto.Sha256(token), clock.UtcNow.AddDays(7)));
                audit.Write(new AuditEntry(AuditAction.PlatformUserInvited, AuditOutcome.Success, "user", user.Id.ToString(),
                    Data: new Dictionary<string, object?> { ["roles"] = body.Roles }));
                await db.SaveChangesAsync(t);
                return (await ToDtosAsync(db, [user], t))[0];
            }, ct);

            await email.SendAsync(key, "You're invited to the HomeBell platform console",
                $"Hello {body.FullName},\n\nSet your password within 7 days, then sign in and set up two-factor authentication:\n" +
                $"{options.PlatformWebBaseUrl.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(token)}\n", ct);
            return Results.Json(dto, BuildingBlocks.Infrastructure.JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequirePlatformPermission(Permission.PlatformUsersManage);

        g.MapPatch("/users/{userId:guid}", async (Guid userId, UpdatePlatformUserRequest body, IdentityDbContext db, SessionService sessions,
            IAuditWriter audit, IUnitOfWork uow, CancellationToken ct) =>
        {
            new Validator()
                .Must(body.Roles is not null || body.Status is not null, "body", "min_properties", "Provide roles or status.")
                .Must(body.Roles is null || body.Roles.Count > 0, "roles", "min_items", "At least one role is required.")
                .OneOf("status", body.Status, [MembershipState.Active, MembershipState.Deactivated])
                .ThrowIfInvalid();
            foreach (var role in body.Roles ?? [])
            {
                new Validator().OneOf("roles", role, PlatformRole.All).ThrowIfInvalid();
            }

            return await uow.ExecuteAsync(async t =>
            {
                var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, t);
                var current = await db.PlatformRoles.Where(r => r.UserId == userId).ToListAsync(t);
                if (user is null || current.Count == 0)
                {
                    throw Problem.NotFound();
                }

                var wasSuper = current.Any(r => r.Role == PlatformRole.PlatformSuperAdmin) && !user.IsDeactivated;
                var losesSuper = wasSuper && ((body.Roles is not null && !body.Roles.Contains(PlatformRole.PlatformSuperAdmin)) || body.Status == MembershipState.Deactivated);
                if (losesSuper)
                {
                    var otherSupers = await db.PlatformRoles
                        .Where(r => r.Role == PlatformRole.PlatformSuperAdmin && r.UserId != userId)
                        .Join(db.Users.Where(u => !u.IsDeactivated), r => r.UserId, u => u.Id, (r, u) => u.Id)
                        .CountAsync(t);
                    if (otherSupers == 0)
                    {
                        throw Problem.Of(ErrorCodes.Conflict, "Cannot remove the last super admin.");
                    }
                }

                if (body.Roles is not null)
                {
                    db.PlatformRoles.RemoveRange(current);
                    db.PlatformRoles.AddRange(body.Roles.Distinct(StringComparer.Ordinal).Select(r => new PlatformRoleAssignment(userId, r)));
                }

                if (body.Status == MembershipState.Deactivated)
                {
                    user.Deactivate();
                }
                else if (body.Status == MembershipState.Active)
                {
                    user.Reactivate();
                }

                audit.Write(new AuditEntry(AuditAction.PlatformUserUpdated, AuditOutcome.Success, "user", userId.ToString(),
                    Data: new Dictionary<string, object?> { ["roles"] = body.Roles, ["status"] = body.Status }));
                await db.SaveChangesAsync(t);
                if (body.Status == MembershipState.Deactivated || body.Roles is not null)
                {
                    // Roles live in the access token: end existing sessions so changes apply now.
                    await sessions.RevokeAllAsync(userId, body.Status == MembershipState.Deactivated ? SessionRevokeReason.AccountDeactivated : SessionRevokeReason.AdminAction, t);
                }

                return (await ToDtosAsync(db, [user], t))[0];
            }, ct);
        }).RequirePlatformPermission(Permission.PlatformUsersManage);
    }

    private static async Task<List<PlatformUserDto>> ToDtosAsync(IdentityDbContext db, IReadOnlyList<UserAccount> users, CancellationToken ct)
    {
        var ids = users.Select(u => u.Id).ToList();
        var roles = await db.PlatformRoles.AsNoTracking().Where(r => ids.Contains(r.UserId)).ToListAsync(ct);
        var mfa = await db.MfaFactors.AsNoTracking().Where(f => ids.Contains(f.UserId) && f.ConfirmedAt != null).Select(f => f.UserId).ToListAsync(ct);
        return users.Select(u => new PlatformUserDto(
            u.Id, u.FullName, u.Email ?? string.Empty,
            roles.Where(r => r.UserId == u.Id).Select(r => r.Role).Order(StringComparer.Ordinal).ToList(),
            u.IsDeactivated ? MembershipState.Deactivated : u.LastLoginAt is null && !mfa.Contains(u.Id) ? MembershipState.Invited : MembershipState.Active,
            mfa.Contains(u.Id),
            u.LastLoginAt)).ToList();
    }
}

/// <summary>Support sessions and usage numbers for the Platform module.</summary>
internal sealed class IdentitySessionIssuer(IdentityDbContext db, SessionService sessions) : ISessionIssuer, IOtpUsage
{
    public async Task<IssuedTokens> IssueSupportSessionAsync(Guid platformUserId, Guid tenantId, int minutes, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstAsync(u => u.Id == platformUserId, cancellationToken);
        var (_, t) = await sessions.IssueAsync(user, SessionKind.Support, SessionScope.SupportReadOnly, null, cancellationToken, tenantId, TimeSpan.FromMinutes(minutes));
        return new IssuedTokens(t.AccessToken, t.AccessTokenExpiresAt, t.RefreshToken, t.RefreshTokenExpiresAt, t.SessionId, t.Scope);
    }

    public async Task RevokeSessionAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        var session = await db.Sessions.FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        if (session is not null)
        {
            await sessions.RevokeAsync(session, SessionRevokeReason.AdminAction, cancellationToken);
        }
    }

    public async Task<int> SentTodayAsync(CancellationToken cancellationToken)
    {
        var start = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        return await db.OtpSends.CountAsync(s => s.At >= start, cancellationToken);
    }
}
