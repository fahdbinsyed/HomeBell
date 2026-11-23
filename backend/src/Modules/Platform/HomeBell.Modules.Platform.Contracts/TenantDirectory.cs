namespace HomeBell.Modules.Platform.Contracts;

/// <summary>Tenant facts other modules may read (names, lifecycle, operational mode, timezone).</summary>
public sealed record TenantInfo(Guid Id, string Name, string Slug, string State, string OperationalMode, string Timezone);

public interface ITenantDirectory
{
    Task<TenantInfo?> FindAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<IReadOnlyDictionary<Guid, TenantInfo>> GetManyAsync(IReadOnlyCollection<Guid> tenantIds, CancellationToken cancellationToken);
}
