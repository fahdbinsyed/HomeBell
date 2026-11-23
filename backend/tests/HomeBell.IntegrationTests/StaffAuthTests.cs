using Microsoft.Extensions.DependencyInjection;
using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

public sealed class StaffAuthTests(ApiFactory factory)
{
    private const string Login = "/v1/auth/staff/login";

    [Fact]
    public async Task School_admin_signs_in_and_gets_memberships_with_permissions()
    {
        using var api = factory.Api();
        var r = await api.PostAsync(Login, new { email = "Admin@Greenfield.test", password = TestData.DemoPassword });

        Assert.Equal(200, r.Status);
        Assert.Equal("authenticated", r["status"].GetString());
        var memberships = r["me"].GetProperty("memberships").EnumerateArray().ToList();
        Assert.Equal(2, memberships.Count);
        var gf = memberships.Single(m => m.GetProperty("tenantName").GetString() == "Greenfield Academy");
        Assert.Equal("school.admin", gf.GetProperty("role").GetString());
        Assert.Equal("full", gf.GetProperty("operationalMode").GetString());
        Assert.Contains(gf.GetProperty("permissions").EnumerateArray(), p => p.GetString() == "school.staff.manage");
        Assert.Equal("staff", r["me"].GetProperty("session").GetProperty("kind").GetString());
    }

    [Fact]
    public async Task Wrong_password_is_invalid_credentials_and_audited()
    {
        using var api = factory.Api();
        var r = await api.PostAsync(Login, new { email = "dispatch@greenfield.test", password = "wrong-password" });

        Assert.Equal(401, r.Status);
        Assert.Equal("INVALID_CREDENTIALS", r.Code);
        var failures = await factory.ScalarAsAppAsync("SELECT count(*) FROM audit.audit_log WHERE action = 'auth.login_failed'", crossTenant: true);
        Assert.True(Convert.ToInt64(failures, System.Globalization.CultureInfo.InvariantCulture) >= 1);
    }

    [Fact]
    public async Task Unknown_email_and_missing_membership_look_identical()
    {
        using var api = factory.Api();
        var unknown = await api.PostAsync(Login, new { email = "nobody@nowhere.test", password = TestData.DemoPassword });
        var platformOnly = await api.PostAsync(Login, new { email = "owner@homebell.test", password = TestData.DemoPassword, audience = "school" });

        Assert.Equal("INVALID_CREDENTIALS", unknown.Code);
        Assert.Equal("INVALID_CREDENTIALS", platformOnly.Code);
    }

    [Fact]
    public async Task Five_failures_lock_the_account()
    {
        using var api = factory.Api();
        // A dedicated account so the lock does not affect other tests.
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var accounts = scope.ServiceProvider.GetRequiredService<HomeBell.Modules.Identity.Contracts.IUserAccounts>();
            await accounts.EnsureByEmailAsync("lockme@greenfield.test", "Lock Me", CancellationToken.None);
        }

        for (var i = 0; i < 5; i++)
        {
            Assert.Equal("INVALID_CREDENTIALS", (await api.PostAsync(Login, new { email = "lockme@greenfield.test", password = "nope" })).Code);
        }

        var locked = await api.PostAsync(Login, new { email = "lockme@greenfield.test", password = "nope" });
        Assert.Equal(423, locked.Status);
        Assert.Equal("ACCOUNT_LOCKED", locked.Code);
        Assert.True(locked["meta"].TryGetProperty("lockedUntil", out _));
    }

    [Fact]
    public async Task Validation_errors_list_every_field()
    {
        using var api = factory.Api();
        var r = await api.PostAsync(Login, new { email = "", audience = "mobile" });

        Assert.Equal(400, r.Status);
        Assert.Equal("VALIDATION_FAILED", r.Code);
        var fields = r["errors"].EnumerateArray().Select(e => e.GetProperty("field").GetString()).ToList();
        Assert.Equal(["email", "password", "audience"], fields);
    }

    [Fact]
    public async Task Platform_sign_in_requires_totp_and_rejects_replayed_codes()
    {
        using var api = factory.Api();
        var step = await api.PostAsync(Login, new { email = "owner@homebell.test", password = TestData.DemoPassword, audience = "platform" });
        Assert.Equal("mfa_required", step["status"].GetString());
        var mfaToken = step["mfaToken"].GetString();

        Assert.Equal("MFA_INVALID", (await api.PostAsync("/v1/auth/staff/mfa/verify", new { mfaToken, code = "123456" })).Code);

        var code = TestData.OwnerTotp(factory);
        var ok = await api.PostAsync("/v1/auth/staff/mfa/verify", new { mfaToken, code });
        Assert.Equal(200, ok.Status);
        Assert.Equal("platform", ok["me"].GetProperty("session").GetProperty("kind").GetString());
        Assert.Contains(ok["me"].GetProperty("platformRoles").EnumerateArray(), r => r.GetString() == "platform.super_admin");

        var replay = await api.PostAsync("/v1/auth/staff/mfa/verify", new { mfaToken, code });
        Assert.Equal("MFA_INVALID", replay.Code);
    }

    [Fact]
    public async Task Platform_user_without_mfa_must_enroll_then_gets_recovery_codes()
    {
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            var db = sp.GetRequiredService<HomeBell.Modules.Identity.Infrastructure.IdentityDbContext>();
            var hasher = sp.GetRequiredService<Microsoft.AspNetCore.Identity.IPasswordHasher<HomeBell.Modules.Identity.Domain.UserAccount>>();
            var user = new HomeBell.Modules.Identity.Domain.UserAccount(Guid.CreateVersion7(), "Ops Person", "ops@homebell.test", null, factory.Clock.UtcNow);
            db.Users.Add(user);
            db.Credentials.Add(new HomeBell.Modules.Identity.Domain.StaffCredential(user.Id, hasher.HashPassword(user, "a-long-password-1"), factory.Clock.UtcNow));
            db.PlatformRoles.Add(new HomeBell.Modules.Identity.Domain.PlatformRoleAssignment(user.Id, "platform.ops_admin"));
            await db.SaveChangesAsync();
        }

        using var api = factory.Api();
        var step = await api.PostAsync(Login, new { email = "ops@homebell.test", password = "a-long-password-1", audience = "platform" });
        Assert.Equal("mfa_enrollment_required", step["status"].GetString());
        var enrollmentToken = step["enrollmentToken"].GetString();

        var start = await api.PostAsync("/v1/auth/staff/mfa/enroll", new { enrollmentToken });
        Assert.Equal(200, start.Status);
        Assert.StartsWith("otpauth://totp/", start["otpauthUri"].GetString(), StringComparison.Ordinal);
        var code = new OtpNet.Totp(OtpNet.Base32Encoding.ToBytes(start["secret"].GetString())).ComputeTotp(factory.Clock.UtcNow.UtcDateTime);

        var done = await api.PostAsync("/v1/auth/staff/mfa/enroll/confirm", new { enrollmentToken, enrollmentId = start["enrollmentId"].GetGuid(), code });
        Assert.Equal(200, done.Status);
        var recovery = done["recoveryCodes"].EnumerateArray().Select(c => c.GetString()!).ToList();
        Assert.Equal(10, recovery.Count);

        // A recovery code works once as the second factor.
        var again = await api.PostAsync(Login, new { email = "ops@homebell.test", password = "a-long-password-1", audience = "platform" });
        var viaRecovery = await api.PostAsync("/v1/auth/staff/mfa/verify", new { mfaToken = again["mfaToken"].GetString(), code = recovery[0] });
        Assert.Equal(200, viaRecovery.Status);
        var reused = await api.PostAsync(Login, new { email = "ops@homebell.test", password = "a-long-password-1", audience = "platform" });
        Assert.Equal("MFA_INVALID", (await api.PostAsync("/v1/auth/staff/mfa/verify", new { mfaToken = reused["mfaToken"].GetString(), code = recovery[0] })).Code);
    }

    [Fact]
    public async Task Password_reset_link_changes_password_and_revokes_sessions()
    {
        using var api = factory.Api();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            var db = sp.GetRequiredService<HomeBell.Modules.Identity.Infrastructure.IdentityDbContext>();
            var hasher = sp.GetRequiredService<Microsoft.AspNetCore.Identity.IPasswordHasher<HomeBell.Modules.Identity.Domain.UserAccount>>();
            var user = new HomeBell.Modules.Identity.Domain.UserAccount(Guid.CreateVersion7(), "Reset Me", "reset@greenfield.test", null, factory.Clock.UtcNow);
            db.Users.Add(user);
            db.Credentials.Add(new HomeBell.Modules.Identity.Domain.StaffCredential(user.Id, hasher.HashPassword(user, "old-password-123"), factory.Clock.UtcNow));
            await db.SaveChangesAsync();
            var schools = sp.GetRequiredService<HomeBell.Modules.Schools.Infrastructure.SchoolsDbContext>();
            using var _ = sp.GetRequiredService<HomeBell.BuildingBlocks.Application.ITenantContext>().Scope(TestData.Greenfield);
            schools.Memberships.Add(new HomeBell.Modules.Schools.Domain.TenantMembership(Guid.CreateVersion7(), TestData.Greenfield, user.Id, "school.front_desk", null, factory.Clock.UtcNow));
            await schools.SaveChangesAsync();
        }

        var session = await api.PostAsync(Login, new { email = "reset@greenfield.test", password = "old-password-123" });
        Assert.Equal(204, (await api.PostAsync("/v1/auth/staff/password/forgot", new { email = "reset@greenfield.test" })).Status);
        Assert.Equal(204, (await api.PostAsync("/v1/auth/staff/password/forgot", new { email = "ghost@greenfield.test" })).Status); // same answer

        var mail = factory.Email.Sent.Last(m => m.To == "reset@greenfield.test");
        var token = Uri.UnescapeDataString(mail.Body.Split("token=")[1].Split('\n')[0].Trim());
        Assert.Equal("PASSWORD_POLICY_VIOLATION", (await api.PostAsync("/v1/auth/staff/password/reset", new { token, newPassword = "short" })).Code);
        Assert.Equal(204, (await api.PostAsync("/v1/auth/staff/password/reset", new { token, newPassword = "brand-new-password-1" })).Status);
        Assert.Equal(410, (await api.PostAsync("/v1/auth/staff/password/reset", new { token, newPassword = "brand-new-password-2" })).Status);

        api.BearerToken = session["tokens"].GetProperty("accessToken").GetString();
        Assert.Equal("SESSION_REVOKED", (await api.GetAsync("/v1/auth/me")).Code);
        api.BearerToken = null;
        Assert.Equal("INVALID_CREDENTIALS", (await api.PostAsync(Login, new { email = "reset@greenfield.test", password = "old-password-123" })).Code);
        Assert.Equal(200, (await api.PostAsync(Login, new { email = "reset@greenfield.test", password = "brand-new-password-1" })).Status);
    }
}
