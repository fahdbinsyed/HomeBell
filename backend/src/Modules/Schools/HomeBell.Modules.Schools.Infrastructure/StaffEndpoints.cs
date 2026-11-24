using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Contracts;
using HomeBell.Modules.Schools.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using P = HomeBell.BuildingBlocks.Domain.Contract.Permission;

namespace HomeBell.Modules.Schools.Infrastructure;

public sealed record StaffMemberDto(Guid MembershipId, Guid UserId, string FullName, string Email, string Role, string Status, bool MfaEnabled, DateTimeOffset? LastLoginAt);

public sealed record StaffInvitationDto(Guid Id, string Email, string FullName, string Role, DateTimeOffset ExpiresAt, ActorRefDto InvitedBy, DateTimeOffset CreatedAt);

public sealed record StaffListDto(IReadOnlyList<StaffMemberDto> Members, IReadOnlyList<StaffInvitationDto> PendingInvitations);

public sealed record CreateStaffInvitationRequest(string? Email, string? FullName, string? Role);

public sealed record UpdateStaffMemberRequest(string? Role);

/// <summary>Staff management (school.staff.manage). A school always keeps at least one active admin.</summary>
internal static class StaffEndpoints
{
    private const string T = "/v1/t/{tenantId:guid}";

    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var t = endpoints.MapGroup(T);

        t.MapGet("/staff", async (SchoolsDbContext db, IUserDirectory users, IClock clock, CancellationToken ct) =>
        {
            var members = await db.Memberships.AsNoTracking().ToListAsync(ct);
            var info = await users.GetManyAsync(members.Select(m => m.UserId).ToList(), ct);
            var pending = await db.StaffInvitations.AsNoTracking().Where(i => i.State == InvitationState.Pending && i.ExpiresAt > clock.UtcNow).OrderBy(i => i.CreatedAt).ToListAsync(ct);
            return new StaffListDto(
                members.Select(m => Member(m, info.GetValueOrDefault(m.UserId))).OrderBy(m => m.FullName, StringComparer.OrdinalIgnoreCase).ToList(),
                pending.Select(Invitation).ToList());
        }).RequireTenantPermission(P.SchoolStaffManage);

        t.MapPost("/staff-invitations", async (Guid tenantId, CreateStaffInvitationRequest b, SchoolsDbContext db, IStaffInvitations invitations, IUserDirectory users, IEntitlements entitlements, IUnitOfWork uow, CancellationToken ct) =>
        {
            new Validator()
                .Required("email", b.Email).MaxLength("email", b.Email, 254)
                .Required("fullName", b.FullName).MaxLength("fullName", b.FullName, 120)
                .Required("role", b.Role).OneOf("role", b.Role, SchoolRole.All)
                .ThrowIfInvalid();
            var email = b.Email!.Trim().ToLowerInvariant();
            var members = await db.Memberships.AsNoTracking().ToListAsync(ct);
            var known = await users.GetManyAsync(members.Select(m => m.UserId).ToList(), ct);
            if (members.Any(m => m.State == MembershipState.Active && known.GetValueOrDefault(m.UserId)?.Email == email))
            {
                throw Problem.Of(ErrorCodes.Conflict, "Already a staff member.");
            }

            await RequireStaffCapacityAsync(db, entitlements, tenantId, ct);
            var inv = await uow.ExecuteAsync(c => invitations.InviteAsync(tenantId, email, b.FullName!.Trim(), b.Role!, c), ct);
            return Results.Json(new StaffInvitationDto(inv.Id, inv.Email, inv.FullName, inv.Role, inv.ExpiresAt, new ActorRefDto(inv.InvitedByType, inv.InvitedById, inv.InvitedByName), inv.CreatedAt),
                JsonDefaults.Options, statusCode: StatusCodes.Status201Created);
        }).RequireTenantPermission(P.SchoolStaffManage, isWrite: true);

        t.MapDelete("/staff-invitations/{invitationId:guid}", async (Guid invitationId, SchoolsDbContext db, CancellationToken ct) =>
        {
            var inv = await db.StaffInvitations.FirstOrDefaultAsync(i => i.Id == invitationId, ct) ?? throw Problem.NotFound();
            if (inv.State == InvitationState.Pending)
            {
                inv.Revoke();
                await db.SaveChangesAsync(ct);
            }

            return Results.NoContent();
        }).RequireTenantPermission(P.SchoolStaffManage, isWrite: true);

        t.MapPatch("/staff/{membershipId:guid}", async (Guid membershipId, UpdateStaffMemberRequest b, SchoolsDbContext db, IUserDirectory users, IAuditWriter audit, CancellationToken ct) =>
        {
            new Validator().Required("role", b.Role).OneOf("role", b.Role, SchoolRole.All).ThrowIfInvalid();
            var m = await FindAsync(db, membershipId, ct);
            if (m.Role == SchoolRole.SchoolAdmin && b.Role != SchoolRole.SchoolAdmin)
            {
                await RequireAnotherAdminAsync(db, m.Id, ct);
            }

            m.ChangeRole(b.Role!);
            audit.Write(new AuditEntry(AuditAction.StaffRoleChanged, AuditOutcome.Success, "membership", m.Id.ToString(), Data: new Dictionary<string, object?> { ["role"] = b.Role }));
            await db.SaveChangesAsync(ct);
            return Member(m, (await users.GetManyAsync([m.UserId], ct)).GetValueOrDefault(m.UserId));
        }).RequireTenantPermission(P.SchoolStaffManage, isWrite: true);

        t.MapPost("/staff/{membershipId:guid}/deactivate", async (Guid membershipId, SchoolsDbContext db, IUserDirectory users, ICurrentActor actor, IAuditWriter audit, CancellationToken ct) =>
        {
            var m = await FindAsync(db, membershipId, ct);
            if (m.UserId == actor.Id)
            {
                throw Problem.Of(ErrorCodes.Conflict, "You cannot deactivate yourself.");
            }

            if (m.Role == SchoolRole.SchoolAdmin && m.State == MembershipState.Active)
            {
                await RequireAnotherAdminAsync(db, m.Id, ct);
            }

            m.Deactivate();
            audit.Write(new AuditEntry(AuditAction.StaffDeactivated, AuditOutcome.Success, "membership", m.Id.ToString()));
            await db.SaveChangesAsync(ct);
            return Member(m, (await users.GetManyAsync([m.UserId], ct)).GetValueOrDefault(m.UserId));
        }).RequireTenantPermission(P.SchoolStaffManage, isWrite: true);

        t.MapPost("/staff/{membershipId:guid}/reactivate", async (Guid tenantId, Guid membershipId, SchoolsDbContext db, IUserDirectory users, IEntitlements entitlements, IAuditWriter audit, CancellationToken ct) =>
        {
            var m = await FindAsync(db, membershipId, ct);
            if (m.State != MembershipState.Active)
            {
                await RequireStaffCapacityAsync(db, entitlements, tenantId, ct);
                m.Reactivate();
                audit.Write(new AuditEntry(AuditAction.StaffRoleChanged, AuditOutcome.Success, "membership", m.Id.ToString(), "reactivated"));
                await db.SaveChangesAsync(ct);
            }

            return Member(m, (await users.GetManyAsync([m.UserId], ct)).GetValueOrDefault(m.UserId));
        }).RequireTenantPermission(P.SchoolStaffManage, isWrite: true);
    }

    private static async Task RequireStaffCapacityAsync(SchoolsDbContext db, IEntitlements entitlements, Guid tenantId, CancellationToken ct)
    {
        var limit = (await entitlements.ResolveAsync(tenantId, ct)).Limits.First(l => l.Key == LimitKey.StaffMax);
        var used = await db.Memberships.CountAsync(m => m.State == MembershipState.Active, ct);
        if (limit.Value is { } max && used >= max)
        {
            throw Problem.Of(ErrorCodes.LimitExceeded, meta: new Dictionary<string, object?> { ["limit"] = LimitKey.StaffMax, ["value"] = max, ["used"] = used });
        }
    }

    private static async Task RequireAnotherAdminAsync(SchoolsDbContext db, Guid exceptMembershipId, CancellationToken ct)
    {
        if (!await db.Memberships.AnyAsync(m => m.Id != exceptMembershipId && m.Role == SchoolRole.SchoolAdmin && m.State == MembershipState.Active, ct))
        {
            throw Problem.Of(ErrorCodes.Conflict, "A school must keep at least one admin.");
        }
    }

    private static async Task<TenantMembership> FindAsync(SchoolsDbContext db, Guid id, CancellationToken ct) =>
        await db.Memberships.FirstOrDefaultAsync(m => m.Id == id, ct) ?? throw Problem.NotFound();

    private static StaffMemberDto Member(TenantMembership m, UserInfo? u) =>
        new(m.Id, m.UserId, u?.FullName ?? "Unknown", u?.Email ?? string.Empty, m.Role, m.State, u?.MfaEnabled ?? false, u?.LastLoginAt);

    private static StaffInvitationDto Invitation(StaffInvitation i) =>
        new(i.Id, i.Email, i.FullName, i.Role, i.ExpiresAt, new ActorRefDto(AuditActorType.User, i.InvitedById, i.InvitedByName), i.CreatedAt);
}
