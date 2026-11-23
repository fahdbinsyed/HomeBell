using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Identity.Application;

/// <summary>OTP controls (docs/architecture/03-identity-auth-otp-devices.md §3). Section <c>Otp</c>.</summary>
public sealed class OtpOptions
{
    public int CodeTtlMinutes { get; set; } = 5;

    public int ResendSpacingSeconds { get; set; } = 60;

    public int MaxSendsPer15Minutes { get; set; } = 3;

    public int MaxSendsPer24Hours { get; set; } = 5;

    public int MaxVerifyAttempts { get; set; } = 5;

    public int LockAfterDeadChallenges { get; set; } = 3;

    public int LockMinutes { get; set; } = 30;

    public int MaxSendsPerIpPerHour { get; set; } = 10;

    public int MaxSendsPerDevicePerHour { get; set; } = 5;

    /// <summary>Calling codes enabled for the tenant regions (e.g. "+1", "+971"). Others → PHONE_NOT_SUPPORTED.</summary>
    public List<string> AllowedCountryCodes { get; set; } = ["+1"];

    /// <summary>Global daily SMS budget; when exhausted → OTP_TEMPORARILY_UNAVAILABLE (generic, no details).</summary>
    public int DailyGlobalBudget { get; set; } = 10_000;

    /// <summary>Base64 HMAC key for code/phone hashes. Ephemeral in Development/Testing when empty.</summary>
    public string? HashKey { get; set; }
}

/// <summary>Counts the policy needs; gathered by the infrastructure from OtpSendLog / OtpChallenge.</summary>
public sealed record OtpSendStats(
    IReadOnlyList<DateTimeOffset> PhoneSendsLast24Hours,
    IReadOnlyList<DateTimeOffset> DeadChallengesLast24Hours,
    int IpSendsLastHour,
    int DeviceSendsLastHour,
    int GlobalSendsToday);

public static class OtpPolicy
{
    /// <summary>Throws the right contract problem when a send is not allowed now.</summary>
    /// <returns>Sends left in the tightest window after this send (contract <c>remainingSends</c>).</returns>
    public static int CheckSend(OtpOptions o, string phone, OtpSendStats s, DateTimeOffset now, DateTimeOffset? lastSentOnChallenge = null)
    {
        ArgumentNullException.ThrowIfNull(o);
        ArgumentNullException.ThrowIfNull(phone);
        ArgumentNullException.ThrowIfNull(s);

        if (!o.AllowedCountryCodes.Any(cc => phone.StartsWith(cc, StringComparison.Ordinal)))
        {
            throw Problem.Of(ErrorCodes.PhoneNotSupported);
        }

        CheckLock(o, s.DeadChallengesLast24Hours, now);

        if (lastSentOnChallenge is { } last && last.AddSeconds(o.ResendSpacingSeconds) > now)
        {
            throw Problem.Of(ErrorCodes.OtpResendTooSoon, meta: RetryAfter(last.AddSeconds(o.ResendSpacingSeconds) - now));
        }

        var in15 = s.PhoneSendsLast24Hours.Where(t => t > now.AddMinutes(-15)).OrderBy(t => t).ToList();
        if (in15.Count >= o.MaxSendsPer15Minutes)
        {
            throw Problem.Of(ErrorCodes.OtpSendLimitReached, meta: RetryAfter(in15[^o.MaxSendsPer15Minutes].AddMinutes(15) - now));
        }

        var in24 = s.PhoneSendsLast24Hours.OrderBy(t => t).ToList();
        if (in24.Count >= o.MaxSendsPer24Hours)
        {
            throw Problem.Of(ErrorCodes.OtpSendLimitReached, meta: RetryAfter(in24[^o.MaxSendsPer24Hours].AddHours(24) - now));
        }

        if (s.IpSendsLastHour >= o.MaxSendsPerIpPerHour || s.DeviceSendsLastHour >= o.MaxSendsPerDevicePerHour)
        {
            throw Problem.Of(ErrorCodes.RateLimited, meta: RetryAfter(TimeSpan.FromHours(1)));
        }

        if (s.GlobalSendsToday >= o.DailyGlobalBudget)
        {
            throw Problem.Of(ErrorCodes.OtpTemporarilyUnavailable);
        }

        return Math.Max(0, Math.Min(o.MaxSendsPer15Minutes - in15.Count - 1, o.MaxSendsPer24Hours - in24.Count - 1));
    }

    /// <summary>3 dead challenges within 24 h lock the phone for 30 min from the last death.</summary>
    public static void CheckLock(OtpOptions o, IReadOnlyList<DateTimeOffset> deadLast24Hours, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(o);
        ArgumentNullException.ThrowIfNull(deadLast24Hours);
        if (deadLast24Hours.Count < o.LockAfterDeadChallenges)
        {
            return;
        }

        var lockedUntil = deadLast24Hours.Max().AddMinutes(o.LockMinutes);
        if (lockedUntil > now)
        {
            throw Problem.Of(ErrorCodes.OtpLocked, meta: new Dictionary<string, object?> { ["lockedUntil"] = lockedUntil });
        }
    }

    private static Dictionary<string, object?> RetryAfter(TimeSpan wait) =>
        new() { ["retryAfterSeconds"] = Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds)) };
}
