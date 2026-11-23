namespace HomeBell.Modules.Identity.Infrastructure;

// Wire DTOs for packages/contracts/openapi/components/identity.yaml. Requests use nullable members so
// missing fields become VALIDATION_FAILED (with field errors) instead of a deserialization exception.

public sealed record TokenPairDto(string AccessToken, DateTimeOffset AccessTokenExpiresAt, string RefreshToken, DateTimeOffset RefreshTokenExpiresAt, Guid SessionId, string Scope);

public sealed record MeSessionDto(Guid Id, string Kind, string Scope, Guid? DeviceId, Guid? SupportTenantId);

public sealed record TenantMembershipSummaryDto(Guid MembershipId, Guid TenantId, string TenantName, string TenantSlug, string Role, IReadOnlyList<string> Permissions, string TenantState, string OperationalMode, string Timezone);

public sealed record GuardianProfileSummaryDto(Guid GuardianId, Guid TenantId, string TenantName, string Kind, string State, string OperationalMode, DateTimeOffset? ValidUntil);

public sealed record MeDto(
    Guid UserId,
    string FullName,
    string? Email,
    string? MaskedPhone,
    string Locale,
    MeSessionDto Session,
    IReadOnlyList<string> PlatformRoles,
    IReadOnlyList<string> PlatformPermissions,
    IReadOnlyList<TenantMembershipSummaryDto> Memberships,
    IReadOnlyList<GuardianProfileSummaryDto> GuardianProfiles,
    bool TermsAcceptanceRequired,
    string CurrentTermsVersion);

// ── staff ───────────────────────────────────────────────────────────────
public sealed record StaffLoginRequest(string? Email, string? Password, string? Audience);

public sealed record StaffLoginAuthenticated(TokenPairDto Tokens, MeDto Me)
{
    public string Status => "authenticated";
}

public sealed record StaffLoginMfaRequired(string MfaToken, DateTimeOffset ExpiresAt)
{
    public string Status => "mfa_required";
}

public sealed record StaffLoginMfaEnrollmentRequired(string EnrollmentToken, DateTimeOffset ExpiresAt)
{
    public string Status => "mfa_enrollment_required";
}

public sealed record MfaVerifyRequest(string? MfaToken, string? Code);

public sealed record MfaEnrollStartRequest(string? EnrollmentToken);

public sealed record MfaEnrollStart(Guid EnrollmentId, string Secret, string OtpauthUri);

public sealed record MfaEnrollConfirmRequest(string? EnrollmentToken, Guid? EnrollmentId, string? Code);

public sealed record MfaEnrollConfirmResult(TokenPairDto Tokens, MeDto Me, IReadOnlyList<string> RecoveryCodes);

public sealed record RefreshRequest(string? RefreshToken);

public sealed record PasswordForgotRequest(string? Email);

public sealed record PasswordResetRequest(string? Token, string? NewPassword);

// ── guardian OTP ────────────────────────────────────────────────────────
public sealed record DeviceInfoDto(string? Platform, string? Model, string? OsVersion, string? AppVersion);

public sealed record OtpSendRequest(string? Phone, string? Purpose);

public sealed record OtpResendRequest(Guid? ChallengeId);

public sealed record OtpVerifyRequest(Guid? ChallengeId, string? Code, DeviceInfoDto? Device);

public sealed record OtpChallengeDto(Guid ChallengeId, string Purpose, string Channel, string MaskedPhone, int CodeLength, DateTimeOffset ExpiresAt, DateTimeOffset ResendAvailableAt, int RemainingSends);

public sealed record OtpVerifyAuthenticated(TokenPairDto Tokens, MeDto Me, IReadOnlyList<GuardianProfileSummaryDto> ActivatedProfiles)
{
    public string Outcome => "authenticated";
}

public sealed record OtpVerifyNoAccount
{
    public string Outcome => "no_account";
}

public sealed record DeviceSummaryDto(Guid DeviceId, string Platform, string Model, string State, DateTimeOffset ActivatedAt, DateTimeOffset? LastSeenAt);

public sealed record DeviceConflictTransferDto(bool Allowed, DateTimeOffset? CooldownEndsAt, bool OverrideActive);

public sealed record DeviceConflictPurchaseDto(bool Available);

public sealed record DeviceConflictDto(string ConflictToken, DateTimeOffset ExpiresAt, DeviceSummaryDto ActiveDevice, DeviceConflictTransferDto Transfer, DeviceConflictPurchaseDto Purchase);

public sealed record OtpVerifyDeviceConflict(DeviceConflictDto Conflict)
{
    public string Outcome => "device_conflict";
}
