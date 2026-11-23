using HomeBell.BuildingBlocks.Domain;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Identity.Domain;

/// <summary>One global account per person (staff, guardian and/or platform user). Global: not tenant-owned.</summary>
public sealed class UserAccount : AggregateRoot
{
    private UserAccount()
        : base(Guid.Empty)
    {
    }

    public UserAccount(Guid id, string fullName, string? email, string? phone, DateTimeOffset createdAt)
        : base(id)
    {
        FullName = fullName;
        Email = email?.Trim().ToLowerInvariant();
        Phone = phone;
        CreatedAt = createdAt;
    }

    public string FullName { get; private set; } = string.Empty;

    /// <summary>Lower-cased; staff/platform sign-in identifier.</summary>
    public string? Email { get; private set; }

    /// <summary>E.164; guardian sign-in identifier.</summary>
    public string? Phone { get; private set; }

    public string Locale { get; set; } = "en";

    public bool IsDeactivated { get; private set; }

    public int FailedLoginCount { get; private set; }

    public DateTimeOffset? LockedUntil { get; private set; }

    public string? TermsVersion { get; private set; }

    public DateTimeOffset? TermsAcceptedAt { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? LastLoginAt { get; private set; }

    public bool IsLocked(DateTimeOffset now) => LockedUntil is { } until && until > now;

    /// <summary>5 consecutive failures lock the account for 15 minutes (same as the mock API).</summary>
    public void RecordFailedLogin(DateTimeOffset now)
    {
        FailedLoginCount++;
        if (FailedLoginCount >= 5)
        {
            LockedUntil = now.AddMinutes(15);
            FailedLoginCount = 0;
        }
    }

    public void RecordLogin(DateTimeOffset now)
    {
        FailedLoginCount = 0;
        LockedUntil = null;
        LastLoginAt = now;
    }

    public void AcceptTerms(string version, DateTimeOffset at)
    {
        TermsVersion = version;
        TermsAcceptedAt = at;
    }

    public void Rename(string fullName) => FullName = fullName;

    public void Deactivate() => IsDeactivated = true;

    public void Reactivate() => IsDeactivated = false;
}

/// <summary>Staff/platform password (ASP.NET Core Identity hash format).</summary>
public sealed class StaffCredential
{
    private StaffCredential()
    {
    }

    public StaffCredential(Guid userId, string passwordHash, DateTimeOffset changedAt)
    {
        UserId = userId;
        PasswordHash = passwordHash;
        ChangedAt = changedAt;
    }

    public Guid UserId { get; private set; }

    public string PasswordHash { get; private set; } = string.Empty;

    public DateTimeOffset ChangedAt { get; private set; }

    public void Change(string hash, DateTimeOffset at)
    {
        PasswordHash = hash;
        ChangedAt = at;
    }
}

public sealed class PlatformRoleAssignment
{
    private PlatformRoleAssignment()
    {
    }

    public PlatformRoleAssignment(Guid userId, string role)
    {
        UserId = userId;
        Role = role;
    }

    public Guid UserId { get; private set; }

    /// <summary>Contract PlatformRole.</summary>
    public string Role { get; private set; } = string.Empty;
}

/// <summary>TOTP factor. <see cref="ProtectedSecret"/> is encrypted with ASP.NET Data Protection.</summary>
public sealed class MfaFactor : Entity
{
    private MfaFactor()
        : base(Guid.Empty)
    {
    }

    public MfaFactor(Guid id, Guid userId, string protectedSecret, DateTimeOffset createdAt)
        : base(id)
    {
        UserId = userId;
        ProtectedSecret = protectedSecret;
        CreatedAt = createdAt;
    }

    public Guid UserId { get; private set; }

    public string ProtectedSecret { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? ConfirmedAt { get; private set; }

    /// <summary>Last accepted TOTP time step (replay protection).</summary>
    public long LastUsedTimeStep { get; set; }

    public void Confirm(DateTimeOffset at) => ConfirmedAt = at;
}

public sealed class RecoveryCode : Entity
{
    private RecoveryCode()
        : base(Guid.Empty)
    {
    }

    public RecoveryCode(Guid id, Guid userId, string codeHash)
        : base(id)
    {
        UserId = userId;
        CodeHash = codeHash;
    }

    public Guid UserId { get; private set; }

    public string CodeHash { get; private set; } = string.Empty;

    public DateTimeOffset? UsedAt { get; private set; }

    public void Use(DateTimeOffset at) => UsedAt = at;
}

/// <summary>
/// A sign-in session. The refresh token is opaque, stored hashed and rotated on every use; presenting an
/// already-rotated token revokes the whole session (REFRESH_TOKEN_REUSED).
/// </summary>
public sealed class Session : AggregateRoot
{
    private Session()
        : base(Guid.Empty)
    {
    }

    public Session(Guid id, Guid userId, string kind, string scope, Guid? deviceId, DateTimeOffset createdAt, DateTimeOffset absoluteExpiresAt, TimeSpan? sliding, Guid? supportTenantId = null)
        : base(id)
    {
        UserId = userId;
        Kind = kind;
        Scope = scope;
        DeviceId = deviceId;
        CreatedAt = createdAt;
        LastSeenAt = createdAt;
        AbsoluteExpiresAt = absoluteExpiresAt;
        SlidingSeconds = sliding is { } s ? (int)s.TotalSeconds : null;
        SupportTenantId = supportTenantId;
    }

    public Guid UserId { get; private set; }

    /// <summary>Contract SessionKind.</summary>
    public string Kind { get; private set; } = SessionKind.Staff;

    /// <summary>Contract SessionScope.</summary>
    public string Scope { get; private set; } = SessionScope.Full;

    public Guid? DeviceId { get; private set; }

    public Guid? SupportTenantId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset LastSeenAt { get; private set; }

    public DateTimeOffset AbsoluteExpiresAt { get; private set; }

    public int? SlidingSeconds { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    /// <summary>Contract SessionRevokeReason.</summary>
    public string? RevokeReason { get; private set; }

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && now < ExpiresAt;

    /// <summary>Effective expiry: min(absolute, lastSeen + sliding window).</summary>
    public DateTimeOffset ExpiresAt =>
        SlidingSeconds is { } s && LastSeenAt.AddSeconds(s) < AbsoluteExpiresAt ? LastSeenAt.AddSeconds(s) : AbsoluteExpiresAt;

    public void Touch(DateTimeOffset now) => LastSeenAt = now;

    public void Revoke(string reason, DateTimeOffset at)
    {
        if (RevokedAt is not null)
        {
            return;
        }

        RevokedAt = at;
        RevokeReason = reason;
    }
}

public sealed class RefreshToken : Entity
{
    private RefreshToken()
        : base(Guid.Empty)
    {
    }

    public RefreshToken(Guid id, Guid sessionId, string tokenHash, DateTimeOffset createdAt)
        : base(id)
    {
        SessionId = sessionId;
        TokenHash = tokenHash;
        CreatedAt = createdAt;
    }

    public Guid SessionId { get; private set; }

    /// <summary>SHA-256 of the opaque token.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? RotatedAt { get; private set; }

    public void MarkRotated(DateTimeOffset at) => RotatedAt = at;
}

/// <summary>A guardian app install (one active device per account — ADR-0010).</summary>
public sealed class DeviceRegistration : AggregateRoot
{
    private DeviceRegistration()
        : base(Guid.Empty)
    {
    }

    public DeviceRegistration(Guid id, Guid userId, Guid installId, string platform, string model, string osVersion, string appVersion, DateTimeOffset activatedAt)
        : base(id)
    {
        UserId = userId;
        InstallId = installId;
        Platform = platform;
        Model = model;
        OsVersion = osVersion;
        AppVersion = appVersion;
        ActivatedAt = activatedAt;
        LastSeenAt = activatedAt;
        State = DeviceState.Active;
    }

    public Guid UserId { get; private set; }

    /// <summary>X-Device-Id sent by the app (secure-storage install id).</summary>
    public Guid InstallId { get; private set; }

    /// <summary>Contract DevicePlatform (android|ios).</summary>
    public string Platform { get; private set; } = DevicePlatform.Android;

    public string Model { get; private set; } = string.Empty;

    public string OsVersion { get; private set; } = string.Empty;

    public string AppVersion { get; private set; } = string.Empty;

    /// <summary>Contract DeviceState.</summary>
    public string State { get; private set; } = DeviceState.Active;

    public DateTimeOffset ActivatedAt { get; private set; }

    public DateTimeOffset? LastSeenAt { get; private set; }

    public void Seen(DateTimeOffset at, string appVersion, string osVersion)
    {
        LastSeenAt = at;
        AppVersion = appVersion;
        OsVersion = osVersion;
    }
}

public static class OtpChallengeStatus
{
    public const string Pending = "pending";
    public const string Verified = "verified";
    public const string Dead = "dead";
}

/// <summary>One OTP challenge. The code is stored only as an HMAC; the plain code is never persisted or logged.</summary>
public sealed class OtpChallenge : AggregateRoot
{
    private OtpChallenge()
        : base(Guid.Empty)
    {
    }

    public OtpChallenge(Guid id, string phone, string phoneHash, string purpose, string codeHash, DateTimeOffset createdAt, DateTimeOffset expiresAt, Guid? deviceInstallId, Guid? invitationId = null)
        : base(id)
    {
        Phone = phone;
        PhoneHash = phoneHash;
        Purpose = purpose;
        CodeHash = codeHash;
        CreatedAt = createdAt;
        ExpiresAt = expiresAt;
        LastSentAt = createdAt;
        DeviceInstallId = deviceInstallId;
        InvitationId = invitationId;
        Status = OtpChallengeStatus.Pending;
    }

    public string Phone { get; private set; } = string.Empty;

    public string PhoneHash { get; private set; } = string.Empty;

    /// <summary>Contract OtpPurpose.</summary>
    public string Purpose { get; private set; } = OtpPurpose.Login;

    public string CodeHash { get; private set; } = string.Empty;

    public int Attempts { get; private set; }

    public string Status { get; private set; } = OtpChallengeStatus.Pending;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset LastSentAt { get; private set; }

    public DateTimeOffset? DiedAt { get; private set; }

    public Guid? DeviceInstallId { get; private set; }

    public Guid? InvitationId { get; private set; }

    /// <summary>Resend: new code, new 5-minute TTL, same challenge (attempts carry over).</summary>
    public void Resend(string codeHash, DateTimeOffset now, DateTimeOffset expiresAt)
    {
        CodeHash = codeHash;
        LastSentAt = now;
        ExpiresAt = expiresAt;
    }

    /// <returns>True when the challenge died with this failure.</returns>
    public bool RecordFailure(int maxAttempts, DateTimeOffset now)
    {
        Attempts++;
        if (Attempts >= maxAttempts)
        {
            Status = OtpChallengeStatus.Dead;
            DiedAt = now;
            return true;
        }

        return false;
    }

    public void MarkVerified() => Status = OtpChallengeStatus.Verified;
}

/// <summary>Every OTP send (OtpLog). Drives per-phone/IP/device limits and the daily budget breaker.</summary>
public sealed class OtpSendLog : Entity
{
    private OtpSendLog()
        : base(Guid.Empty)
    {
    }

    public OtpSendLog(Guid id, string phoneHash, string countryCode, string purpose, string? ipHash, Guid? deviceInstallId, DateTimeOffset at)
        : base(id)
    {
        PhoneHash = phoneHash;
        CountryCode = countryCode;
        Purpose = purpose;
        IpHash = ipHash;
        DeviceInstallId = deviceInstallId;
        At = at;
    }

    public string PhoneHash { get; private set; } = string.Empty;

    public string CountryCode { get; private set; } = string.Empty;

    public string Purpose { get; private set; } = string.Empty;

    public string? IpHash { get; private set; }

    public Guid? DeviceInstallId { get; private set; }

    public DateTimeOffset At { get; private set; }
}

/// <summary>Single-use password-reset token (hashed).</summary>
public sealed class PasswordResetToken : Entity
{
    private PasswordResetToken()
        : base(Guid.Empty)
    {
    }

    public PasswordResetToken(Guid id, Guid userId, string tokenHash, DateTimeOffset expiresAt)
        : base(id)
    {
        UserId = userId;
        TokenHash = tokenHash;
        ExpiresAt = expiresAt;
    }

    public Guid UserId { get; private set; }

    public string TokenHash { get; private set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset? UsedAt { get; private set; }

    public void Use(DateTimeOffset at) => UsedAt = at;
}
