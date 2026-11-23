using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

public sealed class GuardianOtpTests(ApiFactory factory)
{
    private const string Send = "/v1/auth/otp/send";
    private const string Resend = "/v1/auth/otp/resend";
    private const string Verify = "/v1/auth/otp/verify";

    private ApiClient Client()
    {
        var api = factory.Api();
        api.DeviceId = Guid.NewGuid();
        return api;
    }

    [Fact]
    public async Task First_sign_in_activates_pending_profiles_in_every_tenant()
    {
        var phone = TestData.NewPhone();
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, phone, "Sam Parent");
        await TestData.PendingGuardianAsync(factory, TestData.Riverside, phone, "Sam Parent");

        var (api, verify) = await TestData.GuardianSignInAsync(factory, phone);
        using var _ = api;

        Assert.Equal(200, verify.Status);
        Assert.Equal("authenticated", verify["outcome"].GetString());
        Assert.Equal(2, verify["activatedProfiles"].GetArrayLength());
        var profiles = verify["me"].GetProperty("guardianProfiles").EnumerateArray().ToList();
        Assert.All(profiles, p => Assert.Equal("active", p.GetProperty("state").GetString()));
        Assert.True(verify["me"].GetProperty("termsAcceptanceRequired").GetBoolean());
        Assert.Equal("guardian", verify["me"].GetProperty("session").GetProperty("kind").GetString());
        Assert.Equal(api.DeviceId, verify["me"].GetProperty("session").GetProperty("deviceId").GetGuid());

        // Second sign-in on the same device: nothing left to activate.
        var (again, second) = await TestData.GuardianSignInAsync(factory, phone, api.DeviceId);
        using var __ = again;
        Assert.Equal(0, second["activatedProfiles"].GetArrayLength());
    }

    [Fact]
    public async Task Unknown_phone_gets_the_same_challenge_and_no_account_only_after_verification()
    {
        using var api = Client();
        var known = TestData.NewPhone();
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, known);
        var unknown = TestData.NewPhone();

        var a = await api.PostAsync(Send, new { phone = known, purpose = "login" });
        var b = await api.PostAsync(Send, new { phone = unknown, purpose = "login" });
        Assert.Equal(a.Status, b.Status);
        Assert.Equal(
            a.Body.EnumerateObject().Select(p => p.Name).Order(),
            b.Body.EnumerateObject().Select(p => p.Name).Order());

        var v = await api.PostAsync(Verify, new { challengeId = b["challengeId"].GetGuid(), code = "000000", device = TestData.Device() });
        Assert.Equal("no_account", v["outcome"].GetString());
    }

    [Fact]
    public async Task Wrong_codes_count_down_then_the_challenge_dies()
    {
        using var api = Client();
        var phone = TestData.NewPhone();
        var ch = await api.PostAsync(Send, new { phone, purpose = "login" });
        var id = ch["challengeId"].GetGuid();

        for (var left = 4; left >= 1; left--)
        {
            var r = await api.PostAsync(Verify, new { challengeId = id, code = "123123", device = TestData.Device() });
            Assert.Equal("OTP_INVALID", r.Code);
            Assert.Equal(left, r["meta"].GetProperty("remainingAttempts").GetInt32());
        }

        Assert.Equal("OTP_ATTEMPTS_EXCEEDED", (await api.PostAsync(Verify, new { challengeId = id, code = "123123", device = TestData.Device() })).Code);
        // Even the right code no longer works on a dead challenge.
        Assert.Equal("OTP_ATTEMPTS_EXCEEDED", (await api.PostAsync(Verify, new { challengeId = id, code = "000000", device = TestData.Device() })).Code);
    }

    [Fact]
    public async Task Three_dead_challenges_lock_the_phone_for_thirty_minutes()
    {
        using var api = Client();
        var phone = TestData.NewPhone();
        try
        {
            for (var c = 0; c < 3; c++)
            {
                var ch = await api.PostAsync(Send, new { phone, purpose = "login" });
                Assert.Equal(202, ch.Status);
                for (var i = 0; i < 5; i++)
                {
                    await api.PostAsync(Verify, new { challengeId = ch["challengeId"].GetGuid(), code = "999999", device = TestData.Device() });
                }

                factory.Clock.Advance(TimeSpan.FromMinutes(16)); // step past the 3-per-15-minutes send window
            }

            var locked = await api.PostAsync(Send, new { phone, purpose = "login" });
            Assert.Equal("OTP_LOCKED", locked.Code);

            factory.Clock.Advance(TimeSpan.FromMinutes(31));
            api.DeviceId = Guid.NewGuid(); // per-device hourly limit is a separate control
            Assert.Equal(202, (await api.PostAsync(Send, new { phone, purpose = "login" })).Status);
        }
        finally
        {
            factory.Clock.Reset();
        }
    }

    [Fact]
    public async Task Send_limits_three_per_fifteen_minutes_and_resend_spacing()
    {
        using var api = Client();
        var phone = TestData.NewPhone();
        try
        {
            var first = await api.PostAsync(Send, new { phone, purpose = "login" });
            Assert.Equal(2, first["remainingSends"].GetInt32());

            var tooSoon = await api.PostAsync(Resend, new { challengeId = first["challengeId"].GetGuid() });
            Assert.Equal("OTP_RESEND_TOO_SOON", tooSoon.Code);
            Assert.InRange(tooSoon["meta"].GetProperty("retryAfterSeconds").GetInt32(), 55, 60);

            factory.Clock.Advance(TimeSpan.FromSeconds(61));
            var resent = await api.PostAsync(Resend, new { challengeId = first["challengeId"].GetGuid() });
            Assert.Equal(202, resent.Status);
            Assert.Equal(1, resent["remainingSends"].GetInt32());

            Assert.Equal(202, (await api.PostAsync(Send, new { phone, purpose = "login" })).Status);
            var limited = await api.PostAsync(Send, new { phone, purpose = "login" });
            Assert.Equal("OTP_SEND_LIMIT_REACHED", limited.Code);
            Assert.True(limited["meta"].GetProperty("retryAfterSeconds").GetInt32() > 0);
            Assert.Equal(3, factory.Otp.CountFor(phone));
        }
        finally
        {
            factory.Clock.Reset();
        }
    }

    [Fact]
    public async Task Unsupported_country_and_bad_input_are_rejected()
    {
        using var api = Client();
        Assert.Equal("PHONE_NOT_SUPPORTED", (await api.PostAsync(Send, new { phone = "+4930123456", purpose = "login" })).Code);
        Assert.Equal(202, (await api.PostAsync(Send, new { phone = "+971501234567", purpose = "login" })).Status);

        var bad = await api.PostAsync(Send, new { phone = "5551234", purpose = "invitation_redeem" });
        Assert.Equal("VALIDATION_FAILED", bad.Code);
        Assert.Equal(2, bad["errors"].GetArrayLength());
    }

    [Fact]
    public async Task Verify_requires_the_device_header()
    {
        using var api = factory.Api();
        var ch = await api.PostAsync(Send, new { phone = TestData.NewPhone(), purpose = "login" });
        Assert.Equal("DEVICE_ID_REQUIRED", (await api.PostAsync(Verify, new { challengeId = ch["challengeId"].GetGuid(), code = "000000", device = TestData.Device() })).Code);
    }

    [Fact]
    public async Task Second_phone_gets_device_conflict_and_the_first_stays_active()
    {
        var phone = TestData.NewPhone();
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, phone);
        var (first, _) = await TestData.GuardianSignInAsync(factory, phone);
        using var a = first;

        var (second, conflict) = await TestData.GuardianSignInAsync(factory, phone);
        using var b = second;
        Assert.Equal("device_conflict", conflict["outcome"].GetString());
        var c = conflict["conflict"];
        Assert.Equal("Pixel 9", c.GetProperty("activeDevice").GetProperty("model").GetString());
        Assert.True(c.GetProperty("purchase").GetProperty("available").GetBoolean());
        Assert.Null(second.BearerToken);

        Assert.Equal(200, (await first.GetAsync("/v1/auth/me")).Status);
    }

    [Fact]
    public async Task Additional_guardian_profiles_do_not_activate_through_login()
    {
        var phone = TestData.NewPhone();
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, phone, kind: "additional");
        var (api, verify) = await TestData.GuardianSignInAsync(factory, phone);
        using var _ = api;
        Assert.Equal("no_account", verify["outcome"].GetString());
    }

    [Fact]
    public async Task Otp_codes_are_stored_only_as_hashes()
    {
        using var api = Client();
        var phone = TestData.NewPhone();
        var ch = await api.PostAsync(Send, new { phone, purpose = "login" });
        var stored = (string?)await factory.ScalarAsAppAsync($"SELECT code_hash FROM identity.otp_challenge WHERE id = '{ch["challengeId"].GetGuid()}'");
        Assert.NotNull(stored);
        Assert.Equal(64, stored!.Length);
        Assert.DoesNotContain("000000", stored, StringComparison.Ordinal);
    }
}
