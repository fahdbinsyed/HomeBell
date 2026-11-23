using System.Security.Cryptography;
using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Identity.Domain;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using OtpNet;

namespace HomeBell.Modules.Identity.Infrastructure;

public sealed class StaffAuthOptions
{
    /// <summary>Base URL of the school web app, used in password-reset links.</summary>
    public string SchoolWebBaseUrl { get; set; } = "http://localhost:3000";

    /// <summary>Base URL of the platform console, used in platform-user invitation links.</summary>
    public string PlatformWebBaseUrl { get; set; } = "http://localhost:3001";

    public string TotpIssuer { get; set; } = "HomeBell";
}

/// <summary>
/// Staff/platform sign-in (03-identity §1–2): password → (MFA) → session. Platform audience requires a
/// platform role and TOTP; school audience requires an active membership. Failures never reveal which
/// part was wrong (INVALID_CREDENTIALS).
/// </summary>
public sealed partial class StaffAuthService(
    IdentityDbContext db,
    SessionService sessions,
    MeBuilder me,
    IMembershipDirectory memberships,
    IPasswordHasher<UserAccount> hasher,
    IDataProtectionProvider protection,
    IAuditWriter audit,
    IEmailSender email,
    IUnitOfWork uow,
    IClock clock,
    StaffAuthOptions options)
{
    private const string Platform = "platform";
    private const string School = "school";
    private static readonly TimeSpan StepTokenLifetime = TimeSpan.FromMinutes(5);

    private ITimeLimitedDataProtector StepProtector => protection.CreateProtector("hb.identity.staff-step").ToTimeLimitedDataProtector();

    private IDataProtector SecretProtector => protection.CreateProtector("hb.identity.totp-secret");

    public async Task<object> LoginAsync(StaffLoginRequest req, CancellationToken ct)
    {
        new Validator()
            .Required("email", req.Email).MaxLength("email", req.Email, 254)
            .Required("password", req.Password).MaxLength("password", req.Password, 256)
            .OneOf("audience", req.Audience, [School, Platform])
            .ThrowIfInvalid();
        var audience = req.Audience ?? School;
        var emailKey = req.Email!.Trim().ToLowerInvariant();
        var now = clock.UtcNow;

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == emailKey, ct);
        if (user is not null && user.IsLocked(now))
        {
            throw Problem.Of(ErrorCodes.AccountLocked, meta: new Dictionary<string, object?> { ["lockedUntil"] = user.LockedUntil });
        }

        var credential = user is null ? null : await db.Credentials.FirstOrDefaultAsync(c => c.UserId == user.Id, ct);
        var passwordOk = credential is not null
            && hasher.VerifyHashedPassword(user!, credential.PasswordHash, req.Password!) != PasswordVerificationResult.Failed;
        var roles = user is null ? [] : await sessions.PlatformRolesAsync(user.Id, ct);
        var allowed = passwordOk && (audience == Platform
            ? roles.Count > 0
            : (await memberships.ActiveForUserAsync(user!.Id, ct)).Count > 0);

        if (!allowed)
        {
            if (user is not null)
            {
                user.RecordFailedLogin(now);
                await db.SaveChangesAsync(ct);
            }

            await audit.WriteImmediatelyAsync(new AuditEntry(AuditAction.AuthLoginFailed, AuditOutcome.Failed, "user", user?.Id.ToString(),
                Data: new Dictionary<string, object?> { ["audience"] = audience }, ActorIdOverride: user?.Id, ActorDisplayOverride: "Sign-in attempt"), ct);
            throw Problem.Of(ErrorCodes.InvalidCredentials);
        }

        if (user!.IsDeactivated)
        {
            throw Problem.Of(ErrorCodes.AccountDeactivated);
        }

        var hasMfa = await db.MfaFactors.AnyAsync(f => f.UserId == user.Id && f.ConfirmedAt != null, ct);
        if (hasMfa)
        {
            return new StaffLoginMfaRequired(Protect(user.Id, audience, "mfa", out var exp), exp);
        }

        if (audience == Platform)
        {
            return new StaffLoginMfaEnrollmentRequired(Protect(user.Id, audience, "enroll", out var exp), exp);
        }

        return await CompleteAsync(user, audience, ct);
    }

    public async Task<StaffLoginAuthenticated> VerifyMfaAsync(MfaVerifyRequest req, CancellationToken ct)
    {
        new Validator().Required("mfaToken", req.MfaToken).Required("code", req.Code).ThrowIfInvalid();
        var (userId, audience) = Unprotect(req.MfaToken!, "mfa");
        var user = await db.Users.FirstAsync(u => u.Id == userId, ct);
        if (user.IsLocked(clock.UtcNow))
        {
            throw Problem.Of(ErrorCodes.AccountLocked, meta: new Dictionary<string, object?> { ["lockedUntil"] = user.LockedUntil });
        }

        var code = req.Code!.Trim().ToUpperInvariant();
        var ok = code.Length == 6 ? await VerifyTotpAsync(userId, code, ct) : await UseRecoveryCodeAsync(userId, code, ct);
        if (!ok)
        {
            user.RecordFailedLogin(clock.UtcNow);
            await db.SaveChangesAsync(ct);
            await audit.WriteImmediatelyAsync(new AuditEntry(AuditAction.AuthLoginFailed, AuditOutcome.Failed, "user", userId.ToString(),
                "mfa_invalid", ActorIdOverride: userId, ActorDisplayOverride: user.FullName), ct);
            throw Problem.Of(ErrorCodes.MfaInvalid);
        }

        return await CompleteAsync(user, audience, ct);
    }

    public async Task<MfaEnrollStart> StartEnrollmentAsync(MfaEnrollStartRequest req, CancellationToken ct)
    {
        new Validator().Required("enrollmentToken", req.EnrollmentToken).ThrowIfInvalid();
        var (userId, _) = Unprotect(req.EnrollmentToken!, "enroll");
        var user = await db.Users.FirstAsync(u => u.Id == userId, ct);
        var secret = KeyGeneration.GenerateRandomKey(20);
        var base32 = Base32Encoding.ToString(secret);
        var factor = new MfaFactor(Guid.CreateVersion7(), userId, SecretProtector.Protect(base32), clock.UtcNow);
        db.MfaFactors.Add(factor);
        await db.SaveChangesAsync(ct);
        var label = Uri.EscapeDataString($"{options.TotpIssuer}:{user.Email}");
        var uri = $"otpauth://totp/{label}?secret={base32}&issuer={Uri.EscapeDataString(options.TotpIssuer)}&algorithm=SHA1&digits=6&period=30";
        return new MfaEnrollStart(factor.Id, base32, uri);
    }

    public async Task<MfaEnrollConfirmResult> ConfirmEnrollmentAsync(MfaEnrollConfirmRequest req, CancellationToken ct)
    {
        new Validator().Required("enrollmentToken", req.EnrollmentToken).Required("enrollmentId", req.EnrollmentId).Required("code", req.Code)
            .Pattern("code", req.Code, SixDigits(), "code must be 6 digits.").ThrowIfInvalid();
        var (userId, audience) = Unprotect(req.EnrollmentToken!, "enroll");
        var factor = await db.MfaFactors.FirstOrDefaultAsync(f => f.Id == req.EnrollmentId && f.UserId == userId && f.ConfirmedAt == null, ct)
            ?? throw Problem.Of(ErrorCodes.MfaInvalid, "Enrollment not found; start again.");
        if (!CheckTotp(factor, req.Code!))
        {
            throw Problem.Of(ErrorCodes.MfaInvalid);
        }

        return await uow.ExecuteAsync(async t =>
        {
            factor.Confirm(clock.UtcNow);
            var codes = Enumerable.Range(0, 10).Select(_ => NewRecoveryCode()).ToList();
            db.RecoveryCodes.AddRange(codes.Select(c => new RecoveryCode(Guid.CreateVersion7(), userId, IdentityCrypto.Sha256(c))));
            audit.Write(new AuditEntry(AuditAction.AuthMfaEnrolled, AuditOutcome.Success, "user", userId.ToString(), ActorIdOverride: userId));
            await db.SaveChangesAsync(t);
            var user = await db.Users.FirstAsync(u => u.Id == userId, t);
            var done = await CompleteAsync(user, audience, t);
            return new MfaEnrollConfirmResult(done.Tokens, done.Me, codes);
        }, ct);
    }

    /// <summary>Always 204 (no account enumeration). Sends a single-use, 1-hour reset link when the account exists.</summary>
    public async Task ForgotPasswordAsync(PasswordForgotRequest req, CancellationToken ct)
    {
        new Validator().Required("email", req.Email).MaxLength("email", req.Email, 254).ThrowIfInvalid();
        var key = req.Email!.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == key, ct);
        if (user is null || !await db.Credentials.AnyAsync(c => c.UserId == user.Id, ct))
        {
            return;
        }

        var token = IdentityCrypto.NewToken();
        db.PasswordResets.Add(new PasswordResetToken(Guid.CreateVersion7(), user.Id, IdentityCrypto.Sha256(token), clock.UtcNow.AddHours(1)));
        await db.SaveChangesAsync(ct);
        await email.SendAsync(user.Email!, "Reset your HomeBell password",
            $"Hello {user.FullName},\n\nUse this link within 1 hour to choose a new password:\n{options.SchoolWebBaseUrl.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(token)}\n\nIf you did not ask for this, ignore this email.", ct);
    }

    public async Task ResetPasswordAsync(PasswordResetRequest req, CancellationToken ct)
    {
        new Validator().Required("token", req.Token).Required("newPassword", req.NewPassword).ThrowIfInvalid();
        if (req.NewPassword!.Length is < 12 or > 256)
        {
            throw Problem.Of(ErrorCodes.PasswordPolicyViolation, "Password must be 12–256 characters.");
        }

        var now = clock.UtcNow;
        var hash = IdentityCrypto.Sha256(req.Token!);
        var reset = await db.PasswordResets.FirstOrDefaultAsync(r => r.TokenHash == hash, ct);
        if (reset is null || reset.UsedAt is not null || reset.ExpiresAt < now)
        {
            throw Problem.Of(ErrorCodes.StaffInvitationInvalid, "Reset link invalid or expired.");
        }

        await uow.ExecuteAsync(async t =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == reset.UserId, t);
            var credential = await db.Credentials.FirstAsync(c => c.UserId == user.Id, t);
            credential.Change(hasher.HashPassword(user, req.NewPassword), now);
            reset.Use(now);
            user.RecordLogin(now); // clears lockout
            audit.Write(new AuditEntry(AuditAction.AuthPasswordReset, AuditOutcome.Success, "user", user.Id.ToString(), ActorIdOverride: user.Id, ActorDisplayOverride: user.FullName));
            await db.SaveChangesAsync(t);
            await sessions.RevokeAllAsync(user.Id, SessionRevokeReason.PasswordReset, t);
        }, ct);
    }

    private async Task<StaffLoginAuthenticated> CompleteAsync(UserAccount user, string audience, CancellationToken ct)
    {
        user.RecordLogin(clock.UtcNow);
        var kind = audience == Platform ? SessionKind.Platform : SessionKind.Staff;
        audit.Write(new AuditEntry(AuditAction.AuthLogin, AuditOutcome.Success, "user", user.Id.ToString(),
            Data: new Dictionary<string, object?> { ["audience"] = audience }, ActorIdOverride: user.Id, ActorDisplayOverride: user.FullName));
        var (session, tokens) = await sessions.IssueAsync(user, kind, SessionScope.Full, null, ct);
        return new StaffLoginAuthenticated(tokens, await me.BuildAsync(user, session, ct));
    }

    private async Task<bool> VerifyTotpAsync(Guid userId, string code, CancellationToken ct)
    {
        var factor = await db.MfaFactors.FirstOrDefaultAsync(f => f.UserId == userId && f.ConfirmedAt != null, ct);
        if (factor is null || !CheckTotp(factor, code))
        {
            return false;
        }

        await db.SaveChangesAsync(ct);
        return true;
    }

    private bool CheckTotp(MfaFactor factor, string code)
    {
        var secret = Base32Encoding.ToBytes(SecretProtector.Unprotect(factor.ProtectedSecret));
        var totp = new Totp(secret);
        if (!totp.VerifyTotp(clock.UtcNow.UtcDateTime, code, out var step, VerificationWindow.RfcSpecifiedNetworkDelay) || step <= factor.LastUsedTimeStep)
        {
            return false;
        }

        factor.LastUsedTimeStep = step; // a code can be used once
        return true;
    }

    private async Task<bool> UseRecoveryCodeAsync(Guid userId, string code, CancellationToken ct)
    {
        var hash = IdentityCrypto.Sha256(code);
        var rc = await db.RecoveryCodes.FirstOrDefaultAsync(r => r.UserId == userId && r.CodeHash == hash && r.UsedAt == null, ct);
        if (rc is null)
        {
            return false;
        }

        rc.Use(clock.UtcNow);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private string Protect(Guid userId, string audience, string purpose, out DateTimeOffset expiresAt)
    {
        expiresAt = clock.UtcNow.Add(StepTokenLifetime);
        var payload = JsonSerializer.Serialize(new StepToken(userId, audience, purpose));
        return StepProtector.Protect(payload, expiresAt);
    }

    private (Guid UserId, string Audience) Unprotect(string token, string purpose)
    {
        try
        {
            var step = JsonSerializer.Deserialize<StepToken>(StepProtector.Unprotect(token, out _));
            if (step is null || step.Purpose != purpose)
            {
                throw Problem.Unauthenticated("Sign-in step token invalid.");
            }

            return (step.UserId, step.Audience);
        }
        catch (CryptographicException)
        {
            throw Problem.Unauthenticated("Sign-in step expired; sign in again.");
        }
    }

    private static string NewRecoveryCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var chars = Enumerable.Range(0, 8).Select(_ => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)]).ToArray();
        return $"{new string(chars, 0, 4)}-{new string(chars, 4, 4)}";
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"^\d{6}$")]
    private static partial System.Text.RegularExpressions.Regex SixDigits();

    private sealed record StepToken(Guid UserId, string Audience, string Purpose);
}
