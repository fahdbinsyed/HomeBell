namespace HomeBell.BuildingBlocks.Application;

/// <summary>
/// Tenant scope of the current request, resolved once by middleware from the path / token
/// (never from a client header). Repositories cannot be constructed without it.
/// </summary>
public interface ITenantContext
{
    Guid? TenantId { get; }

    bool IsResolved => TenantId.HasValue;
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
    ActorType Type { get; }

    Guid? Id { get; }

    string DisplayName { get; }

    Guid? SessionId { get; }

    Guid? DeviceId { get; }
}

/// <summary>Appends audit entries inside the caller's unit of work (docs/architecture/07-audit-outbox-workers.md).</summary>
public interface IAuditWriter
{
    void Write(AuditEntry entry);
}

public sealed record AuditEntry(
    string Action,
    string Outcome,
    string? TargetType = null,
    string? TargetId = null,
    string? ReasonCode = null,
    IReadOnlyDictionary<string, object?>? Data = null);

/// <summary>Injectable clock (tenant-local "today", cooldowns, expiries are all time-dependent).</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

/// <summary>Stores Idempotency-Key results for 24 h (Redis fast path, PostgreSQL durable).</summary>
public interface IIdempotencyStore
{
    Task<IdempotencyRecord?> GetAsync(string scope, string key, CancellationToken cancellationToken);

    Task<bool> TryBeginAsync(string scope, string key, string requestHash, CancellationToken cancellationToken);

    Task CompleteAsync(string scope, string key, int statusCode, ReadOnlyMemory<byte> body, CancellationToken cancellationToken);
}

public sealed record IdempotencyRecord(string RequestHash, bool Completed, int? StatusCode, ReadOnlyMemory<byte> Body);
