using HomeBell.BuildingBlocks.Domain;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.Modules.Platform.Domain;

/// <summary>One school (docs/architecture/10-domain-model.md, Platform). Control plane: not tenant-owned.</summary>
public sealed class Tenant : AggregateRoot
{
    private Tenant()
        : base(Guid.Empty)
    {
    }

    public Tenant(Guid id, string slug, string name, string timezone, string countryCode, string region, DateTimeOffset createdAt)
        : base(id)
    {
        Slug = slug;
        Name = name;
        Timezone = timezone;
        CountryCode = countryCode;
        Region = region;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
        TermStart = DateOnly.FromDateTime(createdAt.UtcDateTime);
        TermEnd = TermStart.AddYears(1);
        State = TenantLifecycleState.Draft;
    }

    public string Slug { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public string? LegalName { get; private set; }

    public string Region { get; private set; } = string.Empty;

    public string Timezone { get; private set; } = "UTC";

    public string CountryCode { get; private set; } = "US";

    /// <summary>Contract TenantLifecycleState.</summary>
    public string State { get; private set; } = TenantLifecycleState.Draft;

    public string? PreviousOperationalState { get; private set; }

    public DateTimeOffset? ExpiresAt { get; private set; }

    public string DataPlacement { get; private set; } = "shared";

    public string? PlacementKey { get; private set; }

    public DateOnly TermStart { get; private set; }

    public DateOnly TermEnd { get; private set; }

    public string ContactName { get; private set; } = string.Empty;

    public string ContactEmail { get; private set; } = string.Empty;

    public string? ContactPhone { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Drives the ETag / If-Match check on PATCH.</summary>
    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset? LastActivityAt { get; set; }

    public string OperationalMode => TenantLifecycle.OperationalModeOf(State);

    public void Update(string? name, string? legalName, bool setLegalName, string? timezone, DateOnly? termStart, DateOnly? termEnd, DateTimeOffset at)
    {
        Name = name ?? Name;
        LegalName = setLegalName ? legalName : LegalName;
        Timezone = timezone ?? Timezone;
        TermStart = termStart ?? TermStart;
        TermEnd = termEnd ?? TermEnd;
        UpdatedAt = at;
    }

    public void SetContact(string fullName, string email, string? phone, DateTimeOffset at)
    {
        ContactName = fullName;
        ContactEmail = email;
        ContactPhone = phone;
        UpdatedAt = at;
    }

    public void SetLegalName(string? legalName) => LegalName = legalName;

    /// <summary>Applies a transition validated by <see cref="LifecycleRules"/>.</summary>
    public void Transition(string action, string newState, DateTimeOffset? expiresAt, DateTimeOffset at)
    {
        if (LifecycleRules.RemembersPrevious(action) && TenantLifecycle.IsOperational(State))
        {
            PreviousOperationalState = State;
        }

        State = newState;
        if (expiresAt is not null)
        {
            ExpiresAt = expiresAt;
        }
        else if (action == TenantLifecycleAction.GrantFree)
        {
            ExpiresAt = null;
        }

        UpdatedAt = at;
    }

    /// <summary>Initial state at creation (draft, trial or pilot_free).</summary>
    public void Initialize(string state, DateTimeOffset? expiresAt)
    {
        State = state;
        ExpiresAt = expiresAt;
    }

    /// <summary>System expiry sweep (worker, Phase 7).</summary>
    public void Expire(DateTimeOffset at)
    {
        State = TenantLifecycleState.Expired;
        UpdatedAt = at;
    }
}

/// <summary>Lifecycle → operational mode (docs/architecture/05-entitlements-lifecycle.md §4).</summary>
public static class TenantLifecycle
{
    public static string OperationalModeOf(string state) => state switch
    {
        TenantLifecycleState.Draft => BuildingBlocks.Domain.Contract.OperationalMode.Setup,
        TenantLifecycleState.Trial or TenantLifecycleState.PilotFree or TenantLifecycleState.ActivePaid or TenantLifecycleState.ManualOverride
            => BuildingBlocks.Domain.Contract.OperationalMode.Full,
        TenantLifecycleState.Expired or TenantLifecycleState.Suspended => BuildingBlocks.Domain.Contract.OperationalMode.ReadOnly,
        TenantLifecycleState.Deactivated or TenantLifecycleState.Cancelled => BuildingBlocks.Domain.Contract.OperationalMode.Blocked,
        TenantLifecycleState.Offboarding => BuildingBlocks.Domain.Contract.OperationalMode.ExportOnly,
        _ => BuildingBlocks.Domain.Contract.OperationalMode.Blocked,
    };

    public static bool IsOperational(string state) => OperationalModeOf(state) == BuildingBlocks.Domain.Contract.OperationalMode.Full;
}
