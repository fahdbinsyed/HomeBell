namespace HomeBell.BuildingBlocks.Application;

/// <summary>
/// Tenant scope of the current request, resolved once by middleware from the path / token
/// (never from a client header). EF query filters and PostgreSQL RLS both read it
/// (docs/architecture/02-multitenancy.md §4).
/// </summary>
public interface ITenantContext
{
    Guid? TenantId { get; }

    bool IsResolved => TenantId.HasValue;

    /// <summary>True inside an explicit, audited cross-tenant scope (guardian /me aggregation, platform reads).</summary>
    bool IsCrossTenant { get; }

    /// <summary>Monotonic counter, bumped on every change so the DB session state can be re-applied.</summary>
    int Version { get; }

    void SetTenant(Guid tenantId);

    /// <summary>
    /// Temporarily lifts tenant scoping. Use only for reads that legitimately span the caller's own
    /// tenants or for platform operations; <paramref name="reason"/> documents the code path.
    /// </summary>
    IDisposable CrossTenant(string reason);

    /// <summary>Temporarily scopes to another tenant (e.g. a guardian write in one of their tenants).</summary>
    IDisposable Scope(Guid tenantId);
}

public enum ActorType
{
    User,
    System,
    Display,
    Support,
    Provider,
}

/// <summary>Who is acting. Used for authorization, audit and history records.</summary>
public interface ICurrentActor
{
    bool IsAuthenticated { get; }

    ActorType Type { get; }

    Guid? Id { get; }

    string DisplayName { get; }

    Guid? SessionId { get; }

    Guid? DeviceId { get; }

    /// <summary>Contract SessionKind (staff|platform|guardian|display|support).</summary>
    string? SessionKind { get; }

    /// <summary>Contract SessionScope (full|guardian.license_purchase|support.read_only).</summary>
    string? Scope { get; }

    IReadOnlyCollection<string> PlatformRoles { get; }

    /// <summary>Tenant of a platform support session (read-only access), if any.</summary>
    Guid? SupportTenantId { get; }

    string? IpAddress { get; }

    string? UserAgent { get; }

    string RequestId { get; }
}

/// <summary>
/// Appends audit entries to the current unit of work; they are written in the same transaction as the
/// business change (docs/architecture/07-audit-outbox-workers.md §1).
/// </summary>
public interface IAuditWriter
{
    void Write(AuditEntry entry);

    /// <summary>Security events that must survive a rolled-back business transaction (login/OTP failures).</summary>
    Task WriteImmediatelyAsync(AuditEntry entry, CancellationToken cancellationToken);
}

public sealed record AuditEntry(
    string Action,
    string Outcome,
    string? TargetType = null,
    string? TargetId = null,
    string? ReasonCode = null,
    IReadOnlyDictionary<string, object?>? Data = null,
    Guid? TenantId = null,
    Guid? ActorIdOverride = null,
    string? ActorDisplayOverride = null);

/// <summary>Injectable clock (tenant-local "today", cooldowns, expiries are all time-dependent).</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

/// <summary>
/// One database transaction spanning every module DbContext used in the request, so a business change,
/// its audit rows and its outbox messages commit together.
/// </summary>
public interface IUnitOfWork
{
    Task<T> ExecuteAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken cancellationToken);

    Task ExecuteAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken);
}

/// <summary>Stores Idempotency-Key results for 24 h (Redis fast path, PostgreSQL durable).</summary>
public interface IIdempotencyStore
{
    Task<IdempotencyRecord?> GetAsync(string scope, string key, CancellationToken cancellationToken);

    Task<bool> TryBeginAsync(string scope, string key, string requestHash, CancellationToken cancellationToken);

    Task CompleteAsync(string scope, string key, int statusCode, ReadOnlyMemory<byte> body, CancellationToken cancellationToken);
}

public sealed record IdempotencyRecord(string RequestHash, bool Completed, int? StatusCode, ReadOnlyMemory<byte> Body);
