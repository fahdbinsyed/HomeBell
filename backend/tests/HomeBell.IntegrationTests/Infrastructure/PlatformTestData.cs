using HomeBell.Modules.Identity.Domain;
using HomeBell.Modules.Identity.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using OtpNet;

namespace HomeBell.IntegrationTests.Infrastructure;

public static class PlatformTestData
{
    private static int _counter;

    /// <summary>
    /// Creates a platform user with the given roles and a confirmed TOTP factor, signs in (password + TOTP)
    /// and returns an authenticated client. Each user has its own secret, so TOTP replay protection never
    /// interferes between tests.
    /// </summary>
    public static async Task<(ApiClient Client, Guid UserId)> SignInAsync(ApiFactory factory, params string[] roles)
    {
        var email = $"platform{Interlocked.Increment(ref _counter)}-{Guid.NewGuid():N}@homebell.test"[..40] + "@homebell.test";
        var secret = Base32Encoding.ToString(KeyGeneration.GenerateRandomKey(20));
        Guid userId;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            var db = sp.GetRequiredService<IdentityDbContext>();
            var hasher = sp.GetRequiredService<IPasswordHasher<UserAccount>>();
            var protector = sp.GetRequiredService<IDataProtectionProvider>().CreateProtector("hb.identity.totp-secret");
            var user = new UserAccount(Guid.CreateVersion7(), $"Platform {roles[0]}", email, null, factory.Clock.UtcNow);
            db.Users.Add(user);
            db.Credentials.Add(new StaffCredential(user.Id, hasher.HashPassword(user, "platform-password-1"), factory.Clock.UtcNow));
            db.PlatformRoles.AddRange(roles.Select(r => new PlatformRoleAssignment(user.Id, r)));
            var factor = new MfaFactor(Guid.CreateVersion7(), user.Id, protector.Protect(secret), factory.Clock.UtcNow);
            factor.Confirm(factory.Clock.UtcNow);
            db.MfaFactors.Add(factor);
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var api = factory.Api();
        var step = await api.PostAsync("/v1/auth/staff/login", new { email, password = "platform-password-1", audience = "platform" });
        var code = new Totp(Base32Encoding.ToBytes(secret)).ComputeTotp(factory.Clock.UtcNow.UtcDateTime);
        var done = await api.PostAsync("/v1/auth/staff/mfa/verify", new { mfaToken = step["mfaToken"].GetString(), code });
        Assert.Equal(200, done.Status);
        api.BearerToken = done["tokens"].GetProperty("accessToken").GetString();
        return (api, userId);
    }

    public static Task<(ApiClient Client, Guid UserId)> SuperAdminAsync(ApiFactory factory) => SignInAsync(factory, "platform.super_admin");

    public static Dictionary<string, string> Idem(string? key = null) => new() { ["Idempotency-Key"] = key ?? $"test-{Guid.NewGuid()}" };

    public static object NewTenant(string slug, string initialState = "draft", DateTimeOffset? expiresAt = null, bool invite = true, Guid? planVersionId = null) => new
    {
        name = $"School {slug}",
        slug,
        countryCode = "US",
        region = "us-east",
        timezone = "America/New_York",
        termStartDate = "2026-09-01",
        termEndDate = "2027-06-30",
        initialState,
        expiresAt,
        planVersionId,
        primaryContact = new { fullName = "Pat Principal", email = $"principal@{slug}.test" },
        inviteSchoolAdmin = invite,
    };

    public static string Slug() => $"t-{Guid.NewGuid():N}"[..20];
}
