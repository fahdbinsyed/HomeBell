using System.Text.Json;
using HomeBell.Modules.Platform.Domain;

namespace HomeBell.Modules.Platform.Infrastructure;

// Wire DTOs for packages/contracts/openapi/components/platform.yaml. Requests use nullable members so a
// missing field becomes a VALIDATION_FAILED field error.

public sealed record ActorRefDto(string Type, Guid? Id, string DisplayName)
{
    public static ActorRefDto From(ActorStamp a) => new(a.Type, a.Id, a.DisplayName);
}

public sealed record TenantContactDto(string? FullName, string? Email, string? Phone);

public sealed record MoneyDto(long? AmountMinor, string? Currency);

public sealed record PlanVersionDto(
    Guid Id, Guid PlanId, string PlanName, int Version, string Status, MoneyDto Price, string BillingPeriod,
    IReadOnlyDictionary<string, bool> Features, IReadOnlyDictionary<string, int?> Limits, DateTimeOffset CreatedAt, DateTimeOffset? PublishedAt);

public sealed record SubscriptionPlanDto(Guid Id, string Code, string Name, string? Description, bool IsPublic, IReadOnlyList<PlanVersionDto> Versions);

public sealed record TenantSubscriptionDto(Guid Id, Guid TenantId, PlanVersionDto PlanVersion, DateTimeOffset StartsAt, DateTimeOffset EndsAt, string? BillingReference, ActorRefDto CreatedBy, DateTimeOffset CreatedAt);

public sealed record TenantSummaryDto(
    Guid Id, string Slug, string Name, string State, string OperationalMode, string CountryCode, string Region, string? PlanName,
    DateTimeOffset? ExpiresAt, int StudentCount, int ActiveGuardianCount, DateTimeOffset? LastActivityAt, IReadOnlyList<string> Flags, DateTimeOffset CreatedAt);

public sealed record TenantDetailDto(
    Guid Id, string Slug, string Name, string State, string OperationalMode, string CountryCode, string Region, string? PlanName,
    DateTimeOffset? ExpiresAt, int StudentCount, int ActiveGuardianCount, DateTimeOffset? LastActivityAt, IReadOnlyList<string> Flags, DateTimeOffset CreatedAt,
    string? LegalName, string Timezone, DateOnly TermStartDate, DateOnly TermEndDate, string DataPlacement, string? PreviousOperationalState,
    TenantContactDto PrimaryContact, TenantSubscriptionDto? Subscription, IReadOnlyList<string> AllowedActions, DateTimeOffset UpdatedAt);

public sealed record CreateTenantRequest(
    string? Name, string? Slug, string? LegalName, string? CountryCode, string? Region, string? Timezone, DateOnly? TermStartDate, DateOnly? TermEndDate,
    string? InitialState, DateTimeOffset? ExpiresAt, Guid? PlanVersionId, TenantContactDto? PrimaryContact, bool? InviteSchoolAdmin, string? Note);

/// <summary>PATCH body; <see cref="Raw"/> distinguishes "legalName": null (clear) from absent.</summary>
public sealed record UpdateTenantRequest(string? Name, string? LegalName, string? Timezone, DateOnly? TermStartDate, DateOnly? TermEndDate, TenantContactDto? PrimaryContact);

public sealed record LifecycleTransitionRequest(
    string? Action, string? ExpectedState, string? ReasonCode, string? Note, DateTimeOffset? ExpiresAt, string? TargetState,
    Guid? PlanVersionId, int? RetentionDays, string? RefundStatus, string? ConfirmTenantName);

public sealed record LifecycleHistoryEntryDto(Guid Id, string Action, string? FromState, string ToState, string ReasonCode, string? Note, DateTimeOffset? ExpiresAt, string RefundStatus, ActorRefDto Actor, DateTimeOffset At);

public sealed record SetSubscriptionRequest(Guid? PlanVersionId, DateTimeOffset? StartsAt, DateTimeOffset? EndsAt, string? BillingReference, string? Note);

public sealed record EffectiveFeatureDto(string Key, bool Enabled, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

public sealed record EffectiveLimitDto(string Key, int? Value, int? Used, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

public sealed record EffectiveEntitlementsDto(Guid TenantId, string State, string OperationalMode, IReadOnlyList<EffectiveFeatureDto> Features, IReadOnlyList<EffectiveLimitDto> Limits, DateTimeOffset ComputedAt);

public sealed record EntitlementOverrideDto(
    Guid Id, Guid TenantId, string Kind, string Key, JsonElement Value, string ReasonCode, string Note, DateTimeOffset? ExpiresAt,
    ActorRefDto CreatedBy, DateTimeOffset CreatedAt, DateTimeOffset? RevokedAt, ActorRefDto? RevokedBy, string? RevokeNote);

public sealed record CreateEntitlementOverrideRequest(string? Kind, string? Key, JsonElement? Value, string? ReasonCode, string? Note, DateTimeOffset? ExpiresAt);

public sealed record RevokeRequest(string? Note);

public sealed record ItemsDto<T>(IReadOnlyList<T> Items);

public sealed record UsageCounterDto(int Used, int? Limit);

public sealed record GuardianUsageDto(int PrimaryActive, int PrimaryPending, int AdditionalActive, int Blocked, int SeatsAvailable, int SeatsAssigned);

public sealed record PickupUsageDto(int Today, int Last7Days, int Last30Days, int UnresolvedLast30Days);

public sealed record OtpUsageDto(int SentToday, int? DailyBudget);

public sealed record TransferUsageDto(int Last30Days, int SuspiciousLast30Days);

public sealed record TenantUsageDto(Guid TenantId, DateTimeOffset AsOf, UsageCounterDto Students, UsageCounterDto Staff, UsageCounterDto Displays, GuardianUsageDto Guardians, PickupUsageDto Pickups, OtpUsageDto Otp, TransferUsageDto DeviceTransfers);

public sealed record SupportNoteDto(Guid Id, Guid TenantId, string Category, string Body, string RefundStatus, bool Pinned, ActorRefDto Author, DateTimeOffset CreatedAt);

public sealed record CreateSupportNoteRequest(string? Category, string? Body, string? RefundStatus, bool? Pinned);

public sealed record SchoolAdminInvitationRequest(string? Email, string? FullName);

public sealed record StaffInvitationDto(Guid Id, string Email, string FullName, string Role, DateTimeOffset ExpiresAt, ActorRefDto InvitedBy, DateTimeOffset CreatedAt);

public sealed record CreatePlanRequest(string? Code, string? Name, string? Description, bool? IsPublic);

public sealed record CreatePlanVersionRequest(MoneyDto? Price, Dictionary<string, bool>? Features, Dictionary<string, int?>? Limits);

public sealed record FeatureFlagDto(string Key, string Description, bool EnabledByDefault, IReadOnlyList<Guid> TenantAllowList, IReadOnlyList<Guid> TenantDenyList, DateTimeOffset UpdatedAt);

public sealed record UpdateFeatureFlagRequest(bool? EnabledByDefault, List<Guid>? TenantAllowList, List<Guid>? TenantDenyList, string? Note);

public sealed record CreateSupportSessionRequest(Guid? TenantId, string? Reason, int? DurationMinutes);

public sealed record SupportSessionDto(Guid Id, Guid TenantId, string TenantName, string Reason, ActorRefDto PlatformUser, DateTimeOffset StartedAt, DateTimeOffset ExpiresAt, DateTimeOffset? EndedAt);

public sealed record TokenPairDto(string AccessToken, DateTimeOffset AccessTokenExpiresAt, string RefreshToken, DateTimeOffset RefreshTokenExpiresAt, Guid SessionId, string Scope);

public sealed record SupportSessionCreatedDto(Guid Id, Guid TenantId, string TenantName, string Reason, ActorRefDto PlatformUser, DateTimeOffset StartedAt, DateTimeOffset ExpiresAt, DateTimeOffset? EndedAt, TokenPairDto Tokens);

public sealed record AuditLogEntryDto(
    Guid Id, DateTimeOffset OccurredAt, Guid? TenantId, string? TenantName, string Action, string Outcome, ActorRefDto Actor, ActorRefDto? OnBehalfOf,
    string? TargetType, string? TargetId, string? TargetLabel, string? ReasonCode, string? RequestId, Guid? DeviceId, JsonElement Data);
