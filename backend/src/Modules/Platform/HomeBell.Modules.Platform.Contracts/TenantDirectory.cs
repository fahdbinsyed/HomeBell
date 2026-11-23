namespace HomeBell.Modules.Platform.Contracts;

/// <summary>Tenant facts other modules may read (names, lifecycle, operational mode, timezone).</summary>
public sealed record TenantInfo(Guid Id, string Name, string Slug, string State, string OperationalMode, string Timezone);

public interface ITenantDirectory
{
    Task<TenantInfo?> FindAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<IReadOnlyDictionary<Guid, TenantInfo>> GetManyAsync(IReadOnlyCollection<Guid> tenantIds, CancellationToken cancellationToken);
}

public sealed record EffectiveFeatureInfo(string Key, bool Enabled, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

public sealed record EffectiveLimitInfo(string Key, int? Value, int? Used, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

public sealed record EffectiveEntitlementsInfo(Guid TenantId, string State, string OperationalMode, IReadOnlyList<EffectiveFeatureInfo> Features, IReadOnlyList<EffectiveLimitInfo> Limits, DateTimeOffset ComputedAt);

/// <summary>EntitlementResolver (05-entitlements-lifecycle §3) for every module's gates.</summary>
public interface IEntitlements
{
    Task<EffectiveEntitlementsInfo> ResolveAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken cancellationToken);
}
