using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.Modules.Guardians.Contracts;
using HomeBell.Modules.Identity.Application;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Identity.Domain;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace HomeBell.Modules.Identity.Infrastructure;

/// <summary>
/// Guardian OTP sign-in (03-identity §3–4, ADR-0007, ADR-0010). Responses to <c>otp/send</c> are identical
/// whether or not the phone is registered; "no account" is revealed only after a successful verification.
/// </summary>
public sealed partial class GuardianOtpService(
    IdentityDbContext db,
    IdentityCrypto crypto,
    OtpOptions options,
    IOtpSender sender,
    SessionService sessions,
    MeBuilder me,
    IGuardianProfileDirectory guardians,
    IDataProtectionProvider protection,
    IAuditWriter audit,
    ICurrentActor actor,
    IUnitOfWork uow,
    IClock clock,
    IHostEnvironment env)
{
    private const string PhoneHashPurpose = "otp-phone";
    private const string CodeHashPurpose = "otp-code";
    private static readonly string[] SendablePurposes = [OtpPurpose.Login, OtpPurpose.SuspiciousLogin, OtpPurpose.Recovery];

    /// <summary>Development/Testing only: a fixed code (e.g. "000000") so tests and local demos are deterministic.</summary>
    public string? FixedCodeForDevelopment { get; set; }

    public async Task<OtpChallengeDto> SendAsync(OtpSendRequest req, Guid? deviceInstallId, CancellationToken ct)
    {
        new Validator()
            .Required("phone", req.Phone).Pattern("phone", req.Phone, Phone.E164(), "phone must be E.164, e.g. +15551234567.")
            .Required("purpose", req.Purpose).OneOf("purpose", req.Purpose, SendablePurposes)
            .ThrowIfInvalid();
        var phone = req.Phone!;
        var phoneHash = crypto.Hmac(PhoneHashPurpose, phone);
        var now = clock.UtcNow;
        var stats = await StatsAsync(phoneHash, deviceInstallId, now, ct);
        int remaining;
        try
        {
            remaining = OtpPolicy.CheckSend(options, phone, stats, now);
        }
        catch (ApiProblemException ex) when (ex.Code == ErrorCodes.OtpLocked)
        {
            await audit.WriteImmediatelyAsync(new AuditEntry(AuditAction.OtpLocked, AuditOutcome.Denied, "phone", Phone.Mask(phone)), ct);
            throw;
        }

        var code = NewCode();
        var challenge = new OtpChallenge(Guid.CreateVersion7(), phone, phoneHash, req.Purpose!, crypto.Hmac(CodeHashPurpose, code), now, now.AddMinutes(options.CodeTtlMinutes), deviceInstallId);
        db.OtpChallenges.Add(challenge);
        LogSend(phoneHash, phone, req.Purpose!, deviceInstallId, now);
        audit.Write(new AuditEntry(AuditAction.OtpSent, AuditOutcome.Success, "phone", Phone.Mask(phone), Data: new Dictionary<string, object?> { ["purpose"] = req.Purpose }));
        await db.SaveChangesAsync(ct);
        await sender.SendAsync(phone, code, req.Purpose!, ct);
        return ToDto(challenge, remaining);
    }

    public async Task<OtpChallengeDto> ResendAsync(OtpResendRequest req, Guid? deviceInstallId, CancellationToken ct)
    {
        new Validator().Required("challengeId", req.ChallengeId).ThrowIfInvalid();
        var now = clock.UtcNow;
        var challenge = await db.OtpChallenges.FirstOrDefaultAsync(c => c.Id == req.ChallengeId, ct);
        if (challenge is null || challenge.Status != OtpChallengeStatus.Pending)
        {
            throw Problem.Of(ErrorCodes.OtpChallengeNotFound);
        }

        var stats = await StatsAsync(challenge.PhoneHash, deviceInstallId, now, ct);
        var remaining = OtpPolicy.CheckSend(options, challenge.Phone, stats, now, challenge.LastSentAt);
        var code = NewCode();
        challenge.Resend(crypto.Hmac(CodeHashPurpose, code), now, now.AddMinutes(options.CodeTtlMinutes));
        LogSend(challenge.PhoneHash, challenge.Phone, challenge.Purpose, deviceInstallId, now);
        audit.Write(new AuditEntry(AuditAction.OtpSent, AuditOutcome.Success, "phone", Phone.Mask(challenge.Phone), Data: new Dictionary<string, object?> { ["purpose"] = challenge.Purpose, ["resend"] = true }));
        await db.SaveChangesAsync(ct);
        await sender.SendAsync(challenge.Phone, code, challenge.Purpose, ct);
        return ToDto(challenge, remaining);
    }

    public async Task<object> VerifyAsync(OtpVerifyRequest req, Guid deviceInstallId, CancellationToken ct)
    {
        new Validator()
            .Required("challengeId", req.ChallengeId)
            .Required("code", req.Code).Pattern("code", req.Code, SixDigitsRegex(), "code must be 6 digits.")
            .Required("device", req.Device)
            .ThrowIfInvalid();
        var device = req.Device!;
        new Validator()
            .Required("device.platform", device.Platform).OneOf("device.platform", device.Platform, DevicePlatform.All)
            .Required("device.model", device.Model).MaxLength("device.model", device.Model, 100)
            .Required("device.osVersion", device.OsVersion).MaxLength("device.osVersion", device.OsVersion, 50)
            .Required("device.appVersion", device.AppVersion).MaxLength("device.appVersion", device.AppVersion, 50)
            .ThrowIfInvalid();

        var now = clock.UtcNow;
        var challenge = await db.OtpChallenges.FirstOrDefaultAsync(c => c.Id == req.ChallengeId, ct)
            ?? throw Problem.Of(ErrorCodes.OtpChallengeNotFound);
        var dead = await DeadChallengesAsync(challenge.PhoneHash, now, ct);
        OtpPolicy.CheckLock(options, dead, now);
        if (challenge.Status == OtpChallengeStatus.Dead)
        {
            throw Problem.Of(ErrorCodes.OtpAttemptsExceeded);
        }

        if (challenge.Status == OtpChallengeStatus.Verified)
        {
            throw Problem.Of(ErrorCodes.OtpExpired, "Code already used.");
        }

        if (challenge.ExpiresAt < now)
        {
            throw Problem.Of(ErrorCodes.OtpExpired);
        }

        if (!IdentityCrypto.FixedTimeEquals(crypto.Hmac(CodeHashPurpose, req.Code!), challenge.CodeHash))
        {
            var died = challenge.RecordFailure(options.MaxVerifyAttempts, now);
            await db.SaveChangesAsync(ct); // the failed attempt must count even though we return an error
            await audit.WriteImmediatelyAsync(new AuditEntry(AuditAction.OtpFailed, AuditOutcome.Failed, "phone", Phone.Mask(challenge.Phone)), ct);
            if (died)
            {
                if (dead.Count + 1 >= options.LockAfterDeadChallenges)
                {
                    await audit.WriteImmediatelyAsync(new AuditEntry(AuditAction.OtpLocked, AuditOutcome.Denied, "phone", Phone.Mask(challenge.Phone)), ct);
                }

                throw Problem.Of(ErrorCodes.OtpAttemptsExceeded);
            }

            throw Problem.Of(ErrorCodes.OtpInvalid, meta: new Dictionary<string, object?> { ["remainingAttempts"] = options.MaxVerifyAttempts - challenge.Attempts });
        }

        return await uow.ExecuteAsync(async t =>
        {
            challenge.MarkVerified();
            audit.Write(new AuditEntry(AuditAction.OtpVerified, AuditOutcome.Success, "phone", Phone.Mask(challenge.Phone)));
            var user = await db.Users.FirstOrDefaultAsync(u => u.Phone == challenge.Phone, t);
            if (user is null)
            {
                await db.SaveChangesAsync(t);
                return (object)new OtpVerifyNoAccount();
            }

            if (user.IsDeactivated)
            {
                await db.SaveChangesAsync(t);
                throw Problem.Of(ErrorCodes.AccountDeactivated);
            }

            var activated = await guardians.ActivatePendingAsync(user.Id, t);
            var profiles = await guardians.ForUserAsync(user.Id, t);
            if (profiles.Count == 0)
            {
                await db.SaveChangesAsync(t);
                return new OtpVerifyNoAccount();
            }

            // One active device per account (ADR-0010): another active install → device_conflict.
            var active = await db.Devices.FirstOrDefaultAsync(d => d.UserId == user.Id && d.State == DeviceState.Active, t);
            if (active is not null && active.InstallId != deviceInstallId)
            {
                await db.SaveChangesAsync(t);
                return new OtpVerifyDeviceConflict(Conflict(user, active, deviceInstallId, device, profiles, now));
            }

            if (active is null)
            {
                active = new DeviceRegistration(Guid.CreateVersion7(), user.Id, deviceInstallId, device.Platform!, device.Model!, device.OsVersion!, device.AppVersion!, now);
                db.Devices.Add(active);
                audit.Write(new AuditEntry(AuditAction.DeviceRegistered, AuditOutcome.Success, "device", active.Id.ToString(),
                    Data: new Dictionary<string, object?> { ["platform"] = device.Platform, ["model"] = device.Model }, ActorIdOverride: user.Id, ActorDisplayOverride: user.FullName));
            }
            else
            {
                active.Seen(now, device.AppVersion!, device.OsVersion!);
            }

            user.RecordLogin(now);
            audit.Write(new AuditEntry(AuditAction.AuthLogin, AuditOutcome.Success, "user", user.Id.ToString(),
                Data: new Dictionary<string, object?> { ["kind"] = SessionKind.Guardian, ["activatedProfiles"] = activated.Count }, ActorIdOverride: user.Id, ActorDisplayOverride: user.FullName));
            var (session, tokens) = await sessions.IssueAsync(user, SessionKind.Guardian, SessionScope.Full, deviceInstallId, t);
            return new OtpVerifyAuthenticated(tokens, await me.BuildAsync(user, session, t), await me.SummariesAsync(activated, t));
        }, ct);
    }

    private DeviceConflictDto Conflict(UserAccount user, DeviceRegistration active, Guid newInstall, DeviceInfoDto device, IReadOnlyList<GuardianProfileInfo> profiles, DateTimeOffset now)
    {
        var expires = now.AddMinutes(5);
        var payload = JsonSerializer.Serialize(new ConflictToken(user.Id, newInstall, device.Platform!, device.Model!, device.OsVersion!, device.AppVersion!, IdentityCrypto.NewToken()));
        var token = protection.CreateProtector("hb.identity.device-conflict").ToTimeLimitedDataProtector().Protect(payload, expires);
        // Cooldown (30 days since last transfer) and transfer/purchase execution arrive with Phase 5/6.
        var canPurchase = profiles.Any(p => p.Kind == GuardianKind.Primary && p.State == GuardianState.Active);
        return new DeviceConflictDto(
            token,
            expires,
            new DeviceSummaryDto(active.Id, active.Platform, active.Model, active.State, active.ActivatedAt, active.LastSeenAt),
            new DeviceConflictTransferDto(true, null, false),
            new DeviceConflictPurchaseDto(canPurchase));
    }

    private async Task<OtpSendStats> StatsAsync(string phoneHash, Guid? deviceInstallId, DateTimeOffset now, CancellationToken ct)
    {
        var since24 = now.AddHours(-24);
        var sinceHour = now.AddHours(-1);
        var ipHash = IpHash();
        var phoneSends = await db.OtpSends.AsNoTracking().Where(s => s.PhoneHash == phoneHash && s.At > since24).Select(s => s.At).ToListAsync(ct);
        var ipSends = ipHash is null ? 0 : await db.OtpSends.CountAsync(s => s.IpHash == ipHash && s.At > sinceHour, ct);
        var deviceSends = deviceInstallId is null ? 0 : await db.OtpSends.CountAsync(s => s.DeviceInstallId == deviceInstallId && s.At > sinceHour, ct);
        var dayStart = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
        var global = await db.OtpSends.CountAsync(s => s.At >= dayStart, ct);
        return new OtpSendStats(phoneSends, await DeadChallengesAsync(phoneHash, now, ct), ipSends, deviceSends, global);
    }

    private async Task<IReadOnlyList<DateTimeOffset>> DeadChallengesAsync(string phoneHash, DateTimeOffset now, CancellationToken ct)
    {
        var since = now.AddHours(-24);
        return await db.OtpChallenges.AsNoTracking()
            .Where(c => c.PhoneHash == phoneHash && c.Status == OtpChallengeStatus.Dead && c.DiedAt > since)
            .Select(c => c.DiedAt!.Value)
            .ToListAsync(ct);
    }

    private void LogSend(string phoneHash, string phone, string purpose, Guid? deviceInstallId, DateTimeOffset now) =>
        db.OtpSends.Add(new OtpSendLog(Guid.CreateVersion7(), phoneHash, Phone.CountryCode(phone), purpose, IpHash(), deviceInstallId, now));

    private string? IpHash() => actor.IpAddress is { } ip ? crypto.Hmac("otp-ip", ip) : null;

    private string NewCode() =>
        FixedCodeForDevelopment is { } fixedCode && (env.IsDevelopment() || env.IsEnvironment("Testing")) ? fixedCode : IdentityCrypto.NewOtpCode();

    private OtpChallengeDto ToDto(OtpChallenge c, int remaining) =>
        new(c.Id, c.Purpose, OtpChannel.Sms, Phone.Mask(c.Phone), 6, c.ExpiresAt, c.LastSentAt.AddSeconds(options.ResendSpacingSeconds), remaining);

    [System.Text.RegularExpressions.GeneratedRegex(@"^\d{6}$")]
    private static partial System.Text.RegularExpressions.Regex SixDigitsRegex();

    private sealed record ConflictToken(Guid UserId, Guid InstallId, string Platform, string Model, string OsVersion, string AppVersion, string Nonce);
}
