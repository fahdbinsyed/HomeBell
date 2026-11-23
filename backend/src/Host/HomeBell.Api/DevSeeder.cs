using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.Modules.Guardians.Domain;
using HomeBell.Modules.Guardians.Infrastructure;
using HomeBell.Modules.Identity.Domain;
using HomeBell.Modules.Identity.Infrastructure;
using HomeBell.Modules.Platform.Domain;
using HomeBell.Modules.Platform.Infrastructure;
using HomeBell.Modules.Schools.Domain;
using HomeBell.Modules.Schools.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Api;

/// <summary>
/// Local demo data matching the mock API's demo accounts (packages/mocks/README.md). Development only
/// (<c>Seed:Demo=true</c>); idempotent. All values are test values.
/// </summary>
public sealed class DevSeeder(
    PlatformDbContext platform,
    IdentityDbContext identity,
    SchoolsDbContext schools,
    GuardiansDbContext guardians,
    ITenantContext tenant,
    IPasswordHasher<UserAccount> hasher,
    IDataProtectionProvider protection,
    IClock clock)
{
    /// <summary>Well-known demo TOTP secret for owner@homebell.test (add it to an authenticator app).</summary>
    public const string OwnerTotpSecret = "JBSWY3DPEHPK3PXP";

    public static readonly Guid Greenfield = Guid.Parse("0193a000-0000-7000-8000-000000000001");
    public static readonly Guid Riverside = Guid.Parse("0193a000-0000-7000-8000-000000000002");
    public static readonly Guid Hillcrest = Guid.Parse("0193a000-0000-7000-8000-000000000003");

    public async Task SeedAsync(CancellationToken ct)
    {
        using var _ = tenant.CrossTenant("development seed");
        if (await identity.Users.AnyAsync(u => u.Email == "owner@homebell.test", ct))
        {
            return;
        }

        var now = clock.UtcNow;
        var gf = new Tenant(Greenfield, "greenfield", "Greenfield Academy", "America/New_York", "US", "us-east", now);
        gf.ApplyState(TenantLifecycleState.ActivePaid, now.AddYears(1));
        var rv = new Tenant(Riverside, "riverside", "Riverside Primary", "America/Chicago", "US", "us-east", now);
        rv.ApplyState(TenantLifecycleState.Trial, now.AddDays(30));
        var hc = new Tenant(Hillcrest, "hillcrest", "Hillcrest School", "America/Denver", "US", "us-east", now);
        hc.ApplyState(TenantLifecycleState.ActivePaid, now.AddYears(1));
        hc.ApplyState(TenantLifecycleState.Suspended, null);
        platform.Tenants.AddRange(gf, rv, hc);
        await platform.SaveChangesAsync(ct);

        var owner = Staff("Olivia Owner", "owner@homebell.test", now);
        identity.PlatformRoles.Add(new PlatformRoleAssignment(owner.Id, PlatformRole.PlatformSuperAdmin));
        var factor = new MfaFactor(Guid.CreateVersion7(), owner.Id, protection.CreateProtector("hb.identity.totp-secret").Protect(OwnerTotpSecret), now);
        factor.Confirm(now);
        identity.MfaFactors.Add(factor);

        var admin = Staff("Adam Admin", "admin@greenfield.test", now);
        var dispatcher = Staff("Dana Dispatcher", "dispatch@greenfield.test", now);

        var jordan = new UserAccount(Guid.CreateVersion7(), "Jordan Rivera", null, "+15550100001", now);
        var blocked = new UserAccount(Guid.CreateVersion7(), "Blake Blocked", null, "+15550100003", now);
        identity.Users.AddRange(jordan, blocked);
        await identity.SaveChangesAsync(ct);

        schools.Memberships.AddRange(
            new TenantMembership(Guid.CreateVersion7(), Greenfield, admin.Id, SchoolRole.SchoolAdmin, owner.Id, now),
            new TenantMembership(Guid.CreateVersion7(), Greenfield, dispatcher.Id, SchoolRole.SchoolDispatcher, admin.Id, now),
            new TenantMembership(Guid.CreateVersion7(), Riverside, admin.Id, SchoolRole.SchoolAdmin, owner.Id, now));
        await schools.SaveChangesAsync(ct);

        var blockedProfile = new Guardian(Guid.CreateVersion7(), Greenfield, blocked.Id, GuardianKind.Primary, blocked.FullName, blocked.Phone!, now);
        blockedProfile.Activate(now);
        blockedProfile.Block("Court order on file");
        guardians.Guardians.AddRange(
            new Guardian(Guid.CreateVersion7(), Greenfield, jordan.Id, GuardianKind.Primary, jordan.FullName, jordan.Phone!, now),
            new Guardian(Guid.CreateVersion7(), Riverside, jordan.Id, GuardianKind.Primary, jordan.FullName, jordan.Phone!, now),
            blockedProfile);
        await guardians.SaveChangesAsync(ct);
    }

    private UserAccount Staff(string name, string email, DateTimeOffset now)
    {
        var user = new UserAccount(Guid.CreateVersion7(), name, email, null, now);
        identity.Users.Add(user);
        identity.Credentials.Add(new StaffCredential(user.Id, hasher.HashPassword(user, "demo1234"), now));
        return user;
    }
}
