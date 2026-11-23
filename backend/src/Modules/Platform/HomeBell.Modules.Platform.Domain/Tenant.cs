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
        State = TenantLifecycleState.Draft;
    }

    public string Slug { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public string? LegalName { get; set; }

    public string Region { get; private set; } = string.Empty;

    public string Timezone { get; private set; } = "UTC";

    public string CountryCode { get; private set; } = "US";

    /// <summary>Contract TenantLifecycleState.</summary>
    public string State { get; private set; } = TenantLifecycleState.Draft;

    public string? PreviousOperationalState { get; private set; }

    public DateTimeOffset? ExpiresAt { get; private set; }

    public string DataPlacement { get; private set; } = "shared";

    public string? PlacementKey { get; private set; }

    public DateOnly? TermStart { get; set; }

    public DateOnly? TermEnd { get; set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public string OperationalMode => TenantLifecycle.OperationalModeOf(State);

    /// <summary>Applies a validated lifecycle transition (rules in <see cref="TenantLifecycle"/>).</summary>
    public void ApplyState(string newState, DateTimeOffset? expiresAt)
    {
        if (TenantLifecycle.IsOperational(State))
        {
            PreviousOperationalState = State;
        }

        State = newState;
        ExpiresAt = expiresAt;
    }

    public void Rename(string name) => Name = name;
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
