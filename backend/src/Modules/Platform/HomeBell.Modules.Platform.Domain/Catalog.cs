using System.Text.Json;
using HomeBell.BuildingBlocks.Domain;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Platform.Domain;

/// <summary>Who did something, as shown in the contract <c>ActorRef</c>.</summary>
public sealed record ActorStamp(string Type, Guid? Id, string DisplayName);

public sealed class SubscriptionPlan : AggregateRoot
{
    private SubscriptionPlan()
        : base(Guid.Empty)
    {
    }

    public SubscriptionPlan(Guid id, string code, string name, string? description, bool isPublic, DateTimeOffset createdAt)
        : base(id)
    {
        Code = code;
        Name = name;
        Description = description;
        IsPublic = isPublic;
        CreatedAt = createdAt;
    }

    public string Code { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    public bool IsPublic { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }
}

/// <summary>Immutable once published; tenants pin a published version so later changes never alter them.</summary>
public sealed class PlanVersion : Entity
{
    private PlanVersion()
        : base(Guid.Empty)
    {
    }

    public PlanVersion(Guid id, Guid planId, int version, long priceMinor, Dictionary<string, bool> features, Dictionary<string, int?> limits, DateTimeOffset createdAt)
        : base(id)
    {
        PlanId = planId;
        Version = version;
        PriceMinor = priceMinor;
        Features = features;
        Limits = limits;
        CreatedAt = createdAt;
        Status = PlanVersionStatus.Draft;
    }

    public Guid PlanId { get; private set; }

    public int Version { get; private set; }

    /// <summary>Contract PlanVersionStatus.</summary>
    public string Status { get; private set; } = PlanVersionStatus.Draft;

    public long PriceMinor { get; private set; }

    public string Currency { get; private set; } = BuildingBlocks.Domain.Contract.Currency.USD;

    public string BillingPeriod { get; private set; } = BuildingBlocks.Domain.Contract.BillingPeriod.Annual;

    public Dictionary<string, bool> Features { get; private set; } = [];

    public Dictionary<string, int?> Limits { get; private set; } = [];

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? PublishedAt { get; private set; }

    public void Publish(DateTimeOffset at)
    {
        Status = PlanVersionStatus.Published;
        PublishedAt = at;
    }

    public void Retire() => Status = PlanVersionStatus.Retired;
}

public sealed class TenantSubscription : Entity
{
    private TenantSubscription()
        : base(Guid.Empty)
    {
    }

    public TenantSubscription(Guid id, Guid tenantId, Guid planVersionId, DateTimeOffset startsAt, DateTimeOffset endsAt, string? billingReference, ActorStamp createdBy, DateTimeOffset createdAt)
        : base(id)
    {
        TenantId = tenantId;
        PlanVersionId = planVersionId;
        StartsAt = startsAt;
        EndsAt = endsAt;
        BillingReference = billingReference;
        CreatedBy = createdBy;
        CreatedAt = createdAt;
    }

    public Guid TenantId { get; private set; }

    public Guid PlanVersionId { get; private set; }

    public DateTimeOffset StartsAt { get; private set; }

    public DateTimeOffset EndsAt { get; private set; }

    public string? BillingReference { get; private set; }

    public ActorStamp CreatedBy { get; private set; } = new("system", null, "System");

    public DateTimeOffset CreatedAt { get; private set; }

    public void Replace(Guid planVersionId, DateTimeOffset startsAt, DateTimeOffset endsAt, string? billingReference, ActorStamp by, DateTimeOffset at)
    {
        PlanVersionId = planVersionId;
        StartsAt = startsAt;
        EndsAt = endsAt;
        BillingReference = billingReference;
        CreatedBy = by;
        CreatedAt = at;
    }
}

/// <summary>Operator override of a feature or limit; latest active one wins per key.</summary>
public sealed class EntitlementOverride : Entity
{
    private EntitlementOverride()
        : base(Guid.Empty)
    {
    }

    public EntitlementOverride(Guid id, Guid tenantId, string kind, string key, string valueJson, string reasonCode, string note, DateTimeOffset? expiresAt, ActorStamp createdBy, DateTimeOffset createdAt)
        : base(id)
    {
        TenantId = tenantId;
        Kind = kind;
        Key = key;
        ValueJson = valueJson;
        ReasonCode = reasonCode;
        Note = note;
        ExpiresAt = expiresAt;
        CreatedBy = createdBy;
        CreatedAt = createdAt;
    }

    public Guid TenantId { get; private set; }

    /// <summary>Contract EntitlementKind (feature|limit).</summary>
    public string Kind { get; private set; } = EntitlementKind.Feature;

    public string Key { get; private set; } = string.Empty;

    /// <summary>JSON literal: true/false for features, an integer or null (unlimited) for limits.</summary>
    public string ValueJson { get; private set; } = "null";

    public string ReasonCode { get; private set; } = LifecycleReasonCode.Other;

    public string Note { get; private set; } = string.Empty;

    public DateTimeOffset? ExpiresAt { get; private set; }

    public ActorStamp CreatedBy { get; private set; } = new("system", null, "System");

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    public ActorStamp? RevokedBy { get; private set; }

    public string? RevokeNote { get; private set; }

    public bool BoolValue => ValueJson == "true";

    public int? IntValue => int.TryParse(ValueJson, out var v) ? v : null;

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && (ExpiresAt is null || ExpiresAt > now);

    public void Revoke(ActorStamp by, string note, DateTimeOffset at)
    {
        RevokedAt = at;
        RevokedBy = by;
        RevokeNote = note;
    }

    public JsonElement ValueElement() => JsonDocument.Parse(ValueJson).RootElement.Clone();
}

/// <summary>Global kill switch / staged rollout. Can only restrict entitlements.</summary>
public sealed class FeatureFlag
{
    private FeatureFlag()
    {
    }

    public FeatureFlag(string key, string description, bool enabledByDefault, DateTimeOffset updatedAt)
    {
        Key = key;
        Description = description;
        EnabledByDefault = enabledByDefault;
        UpdatedAt = updatedAt;
    }

    public string Key { get; private set; } = string.Empty;

    public string Description { get; private set; } = string.Empty;

    public bool EnabledByDefault { get; private set; }

    public List<Guid> TenantAllowList { get; private set; } = [];

    public List<Guid> TenantDenyList { get; private set; } = [];

    public DateTimeOffset UpdatedAt { get; private set; }

    public bool IsEnabledFor(Guid tenantId) =>
        !TenantDenyList.Contains(tenantId) && (EnabledByDefault || TenantAllowList.Contains(tenantId));

    public void Update(bool enabledByDefault, List<Guid> allow, List<Guid> deny, DateTimeOffset at)
    {
        EnabledByDefault = enabledByDefault;
        TenantAllowList = allow;
        TenantDenyList = deny;
        UpdatedAt = at;
    }
}

/// <summary>Append-only support note. Refunds are recorded, never processed (05-entitlements §1).</summary>
public sealed class SupportNote : Entity
{
    private SupportNote()
        : base(Guid.Empty)
    {
    }

    public SupportNote(Guid id, Guid tenantId, string category, string body, string refundStatus, bool pinned, ActorStamp author, DateTimeOffset createdAt)
        : base(id)
    {
        TenantId = tenantId;
        Category = category;
        Body = body;
        RefundStatus = refundStatus;
        Pinned = pinned;
        Author = author;
        CreatedAt = createdAt;
    }

    public Guid TenantId { get; private set; }

    public string Category { get; private set; } = NoteCategory.General;

    public string Body { get; private set; } = string.Empty;

    public string RefundStatus { get; private set; } = BuildingBlocks.Domain.Contract.RefundStatus.None;

    public bool Pinned { get; private set; }

    public ActorStamp Author { get; private set; } = new("system", null, "System");

    public DateTimeOffset CreatedAt { get; private set; }
}

/// <summary>Read-only, time-boxed (≤ 30 min) platform access to one tenant, with a reason. Audited.</summary>
public sealed class SupportSession : Entity
{
    private SupportSession()
        : base(Guid.Empty)
    {
    }

    public SupportSession(Guid id, Guid tenantId, Guid platformUserId, string platformUserName, string reason, Guid identitySessionId, DateTimeOffset startedAt, DateTimeOffset expiresAt)
        : base(id)
    {
        TenantId = tenantId;
        PlatformUserId = platformUserId;
        PlatformUserName = platformUserName;
        Reason = reason;
        IdentitySessionId = identitySessionId;
        StartedAt = startedAt;
        ExpiresAt = expiresAt;
    }

    public Guid TenantId { get; private set; }

    public Guid PlatformUserId { get; private set; }

    public string PlatformUserName { get; private set; } = string.Empty;

    public string Reason { get; private set; } = string.Empty;

    public Guid IdentitySessionId { get; private set; }

    public DateTimeOffset StartedAt { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset? EndedAt { get; private set; }

    public void End(DateTimeOffset at) => EndedAt ??= at;
}

public sealed class TenantLifecycleHistory : Entity
{
    private TenantLifecycleHistory()
        : base(Guid.Empty)
    {
    }

    public TenantLifecycleHistory(Guid id, Guid tenantId, string action, string? fromState, string toState, string reasonCode, string? note, DateTimeOffset? expiresAt, string refundStatus, ActorStamp actor, DateTimeOffset at)
        : base(id)
    {
        TenantId = tenantId;
        Action = action;
        FromState = fromState;
        ToState = toState;
        ReasonCode = reasonCode;
        Note = note;
        ExpiresAt = expiresAt;
        RefundStatus = refundStatus;
        Actor = actor;
        At = at;
    }

    public Guid TenantId { get; private set; }

    public string Action { get; private set; } = string.Empty;

    public string? FromState { get; private set; }

    public string ToState { get; private set; } = string.Empty;

    public string ReasonCode { get; private set; } = LifecycleReasonCode.Other;

    public string? Note { get; private set; }

    public DateTimeOffset? ExpiresAt { get; private set; }

    public string RefundStatus { get; private set; } = BuildingBlocks.Domain.Contract.RefundStatus.None;

    public ActorStamp Actor { get; private set; } = new("system", null, "System");

    public DateTimeOffset At { get; private set; }
}
