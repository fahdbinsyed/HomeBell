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
            // Databases seeded before Phase 2b have no catalog yet.
            if (!await platform.Plans.AnyAsync(ct))
            {
                SeedCatalog(clock.UtcNow);
                await platform.SaveChangesAsync(ct);
            }

            await SeedSchoolDataAsync(ct);
            return;
        }

        var now = clock.UtcNow;
        var gf = new Tenant(Greenfield, "greenfield", "Greenfield Academy", "America/New_York", "US", "us-east", now);
        gf.Initialize(TenantLifecycleState.ActivePaid, now.AddYears(1));
        gf.SetContact("Grace Principal", "principal@greenfield.test", null, now);
        var rv = new Tenant(Riverside, "riverside", "Riverside Primary", "America/Chicago", "US", "us-east", now);
        rv.Initialize(TenantLifecycleState.Trial, now.AddDays(30));
        rv.SetContact("Rita Head", "head@riverside.test", null, now);
        var hc = new Tenant(Hillcrest, "hillcrest", "Hillcrest School", "America/Denver", "US", "us-east", now);
        hc.Initialize(TenantLifecycleState.ActivePaid, now.AddYears(1));
        hc.Transition(TenantLifecycleAction.Suspend, TenantLifecycleState.Suspended, null, now);
        hc.SetContact("Hal Office", "office@hillcrest.test", null, now);
        platform.Tenants.AddRange(gf, rv, hc);
        SeedCatalog(now);
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
        await SeedSchoolDataAsync(ct);
    }

    /// <summary>Classes, students and guardian links (Phase 2c). Skipped when classes already exist.</summary>
    private async Task SeedSchoolDataAsync(CancellationToken ct)
    {
        if (await schools.Classes.AnyAsync(ct))
        {
            return;
        }

        var now = clock.UtcNow;
        var g1 = new SchoolClass(Guid.CreateVersion7(), Greenfield, "Grade 1", "1", 1);
        var g2 = new SchoolClass(Guid.CreateVersion7(), Greenfield, "Grade 2", "2", 2);
        var rec = new SchoolClass(Guid.CreateVersion7(), Riverside, "Reception", "R", 0);
        var s1a = new Section(Guid.CreateVersion7(), Greenfield, g1.Id, "1A");
        var s1b = new Section(Guid.CreateVersion7(), Greenfield, g1.Id, "1B");
        schools.Classes.AddRange(g1, g2, rec);
        schools.Sections.AddRange(s1a, s1b);
        var leo = new Student(Guid.CreateVersion7(), Greenfield, "GF-001", "Leo", "Rivera", null, g1.Id, s1a.Id, DismissalEligibility.Eligible, null, null, now);
        var maya = new Student(Guid.CreateVersion7(), Greenfield, "GF-002", "Maya", "Rivera", null, g2.Id, null, DismissalEligibility.Eligible, null, null, now);
        var ben = new Student(Guid.CreateVersion7(), Greenfield, "GF-003", "Ben", "Blocked", null, g1.Id, s1b.Id, DismissalEligibility.Hold, null, "Pickup restricted to court-approved adults.", now);
        var noah = new Student(Guid.CreateVersion7(), Riverside, "RV-001", "Noah", "Rivera", null, rec.Id, null, DismissalEligibility.Eligible, null, null, now);
        schools.Students.AddRange(leo, maya, ben, noah);
        await schools.SaveChangesAsync(ct);

        var byPhone = await guardians.Guardians.ToListAsync(ct);
        Guid G(Guid tenantId, string phone) => byPhone.First(x => x.TenantId == tenantId && x.Phone == phone).Id;
        guardians.Links.AddRange(
            new GuardianStudentLink(Guid.CreateVersion7(), Greenfield, G(Greenfield, "+15550100001"), leo.Id, Relationship.Parent, true, now),
            new GuardianStudentLink(Guid.CreateVersion7(), Greenfield, G(Greenfield, "+15550100001"), maya.Id, Relationship.Parent, true, now),
            new GuardianStudentLink(Guid.CreateVersion7(), Greenfield, G(Greenfield, "+15550100003"), ben.Id, Relationship.Father, true, now),
            new GuardianStudentLink(Guid.CreateVersion7(), Riverside, G(Riverside, "+15550100001"), noah.Id, Relationship.Parent, true, now));
        await guardians.SaveChangesAsync(ct);
    }

    public static readonly Guid StandardPlan = Guid.Parse("0193a000-0000-7000-8000-0000000000a1");
    public static readonly Guid StandardV1 = Guid.Parse("0193a000-0000-7000-8000-0000000000a2");

    /// <summary>Standard plan v1 (published) + feature flags for every feature key; Greenfield/Hillcrest subscribe.</summary>
    private void SeedCatalog(DateTimeOffset now)
    {
        platform.Plans.Add(new SubscriptionPlan(StandardPlan, "standard", "Standard", "Everything a school needs for dismissal.", true, now));
        var features = FeatureKey.All.ToDictionary(k => k, k => !k.StartsWith("audio.", StringComparison.Ordinal) && !k.StartsWith("qr.", StringComparison.Ordinal) && !k.StartsWith("campus.", StringComparison.Ordinal) && !k.StartsWith("sso.", StringComparison.Ordinal));
        var limits = new Dictionary<string, int?>
        {
            [LimitKey.StudentsMax] = 2000,
            [LimitKey.StaffMax] = 50,
            [LimitKey.DisplaysMax] = 5,
            [LimitKey.AdditionalGuardiansMaxPerStudent] = 3,
            [LimitKey.OtpDailyBudget] = 2000,
            [LimitKey.ImportsMaxRows] = 5000,
        };
        var v1 = new PlanVersion(StandardV1, StandardPlan, 1, 250_000, features, limits, now);
        v1.Publish(now);
        platform.PlanVersions.Add(v1);
        foreach (var key in FeatureKey.All)
        {
            var future = key.StartsWith("audio.", StringComparison.Ordinal) || key.StartsWith("qr.", StringComparison.Ordinal) || key.StartsWith("campus.", StringComparison.Ordinal) || key.StartsWith("sso.", StringComparison.Ordinal);
            platform.FeatureFlags.Add(new FeatureFlag(key, future ? "Future feature (reserved)" : $"Kill switch for {key}", !future, now));
        }


        platform.Subscriptions.Add(new TenantSubscription(Guid.CreateVersion7(), Greenfield, StandardV1, now, now.AddYears(1), "PO-1001", new ActorStamp(AuditActorType.System, null, "Seed"), now));
        platform.Subscriptions.Add(new TenantSubscription(Guid.CreateVersion7(), Hillcrest, StandardV1, now, now.AddYears(1), "PO-1002", new ActorStamp(AuditActorType.System, null, "Seed"), now));
    }

    private UserAccount Staff(string name, string email, DateTimeOffset now)
    {
        var user = new UserAccount(Guid.CreateVersion7(), name, email, null, now);
        identity.Users.Add(user);
        identity.Credentials.Add(new StaffCredential(user.Id, hasher.HashPassword(user, "demo1234"), now));
        return user;
    }
}
