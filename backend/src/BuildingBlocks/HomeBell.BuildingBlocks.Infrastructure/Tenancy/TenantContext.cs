using HomeBell.BuildingBlocks.Application;

namespace HomeBell.BuildingBlocks.Infrastructure.Tenancy;

/// <summary>
/// Scoped (one per request). Read by EF query filters, the SaveChanges guard and the PostgreSQL session
/// variables that drive RLS. Scopes nest and restore the previous state on dispose.
/// </summary>
public sealed class TenantContext : ITenantContext
{
    private Guid? _tenantId;
    private int _crossTenantDepth;

    public Guid? TenantId => _tenantId;

    public bool IsCrossTenant => _crossTenantDepth > 0;

    public int Version { get; private set; }

    /// <summary>Last cross-tenant reason (diagnostics only).</summary>
    public string? CrossTenantReason { get; private set; }

    public void SetTenant(Guid tenantId)
    {
        if (_tenantId is { } existing && existing != tenantId)
        {
            throw new InvalidOperationException("Tenant already resolved for this request; use Scope() to act in another tenant.");
        }

        _tenantId = tenantId;
        Version++;
    }

    public IDisposable CrossTenant(string reason)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        _crossTenantDepth++;
        CrossTenantReason = reason;
        Version++;
        return new Restore(() =>
        {
            _crossTenantDepth--;
            Version++;
        });
    }

    public IDisposable Scope(Guid tenantId)
    {
        var previous = _tenantId;
        _tenantId = tenantId;
        Version++;
        return new Restore(() =>
        {
            _tenantId = previous;
            Version++;
        });
    }

    private sealed class Restore(Action onDispose) : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            onDispose();
        }
    }
}
