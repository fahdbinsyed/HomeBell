using HomeBell.BuildingBlocks.Application;
using HomeBell.Modules.Identity.Application;

namespace HomeBell.IntegrationTests;

/// <summary>Pure rules: OTP policy and log masking (no database).</summary>
public sealed class OtpPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 23, 12, 0, 0, TimeSpan.Zero);
    private static readonly OtpOptions Options = new() { AllowedCountryCodes = ["+1", "+971"] };

    private static OtpSendStats Stats(int sentMinutesAgo = -1, int count = 0, int dead = 0, int ip = 0, int device = 0, int global = 0) =>
        new(Enumerable.Range(0, count).Select(i => Now.AddMinutes(-(sentMinutesAgo + i))).ToList(),
            Enumerable.Range(0, dead).Select(i => Now.AddMinutes(-(1 + i))).ToList(), ip, device, global);

    private static string CodeOf(Action a) => Assert.Throws<ApiProblemException>(a).Code;

    [Fact]
    public void First_send_leaves_two_in_the_window() => Assert.Equal(2, OtpPolicy.CheckSend(Options, "+15551234567", Stats(), Now));

    [Fact]
    public void Fourth_send_in_fifteen_minutes_is_refused() =>
        Assert.Equal("OTP_SEND_LIMIT_REACHED", CodeOf(() => OtpPolicy.CheckSend(Options, "+15551234567", Stats(sentMinutesAgo: 1, count: 3), Now)));

    [Fact]
    public void Sixth_send_in_a_day_is_refused() =>
        Assert.Equal("OTP_SEND_LIMIT_REACHED", CodeOf(() => OtpPolicy.CheckSend(Options, "+15551234567", Stats(sentMinutesAgo: 60, count: 5), Now)));

    [Fact]
    public void Three_recent_dead_challenges_lock() =>
        Assert.Equal("OTP_LOCKED", CodeOf(() => OtpPolicy.CheckSend(Options, "+15551234567", Stats(dead: 3), Now)));

    [Fact]
    public void Ip_device_and_budget_limits()
    {
        Assert.Equal("RATE_LIMITED", CodeOf(() => OtpPolicy.CheckSend(Options, "+15551234567", Stats(ip: 10), Now)));
        Assert.Equal("RATE_LIMITED", CodeOf(() => OtpPolicy.CheckSend(Options, "+15551234567", Stats(device: 5), Now)));
        Assert.Equal("OTP_TEMPORARILY_UNAVAILABLE", CodeOf(() => OtpPolicy.CheckSend(Options, "+15551234567", Stats(global: 10_000), Now)));
    }

    [Fact]
    public void Country_allowlist() =>
        Assert.Equal("PHONE_NOT_SUPPORTED", CodeOf(() => OtpPolicy.CheckSend(Options, "+447700900000", Stats(), Now)));
}

public sealed class LogMaskingTests
{
    [Theory]
    [InlineData("phone=+15550100001", "phone=+1•••••0001")]
    [InlineData("call +971501234567 now", "call +971•••••4567 now")]
    [InlineData("code=123456", "code=[REDACTED]")]
    [InlineData("your code is 482913", "your code is ••••••")]
    [InlineData("password: hunter2-long", "password: [REDACTED]")]
    [InlineData("Login failed for owner@homebell.test", "Login failed for o•••@homebell.test")]
    [InlineData("Authorization: Bearer abc.def.ghi", "Authorization: Bearer [REDACTED]")]
    public void Scrub_masks_sensitive_values(string input, string expected) => Assert.Equal(expected, SensitiveData.Scrub(input));

    [Fact]
    public void Record_ids_stay_readable() =>
        Assert.Equal("guardian 0193a1b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b blocked", SensitiveData.Scrub("guardian 0193a1b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b blocked"));

    [Fact]
    public void Unknown_sensitive_data_is_never_written_in_clear() =>
        Assert.Equal("[MASKED:11 chars]", SensitiveData.Mask("secret note"));
}
