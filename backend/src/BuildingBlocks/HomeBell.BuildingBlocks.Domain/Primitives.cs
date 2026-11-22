namespace HomeBell.BuildingBlocks.Domain;

/// <summary>Marker for domain events raised by aggregates and dispatched via the module outbox.</summary>
public interface IDomainEvent
{
    Guid EventId { get; }

    DateTimeOffset OccurredAt { get; }
}

/// <summary>
/// Every tenant-owned entity implements this. EF global query filters, the SaveChanges interceptor and
/// PostgreSQL RLS all key on <see cref="TenantId"/> (docs/architecture/02-multitenancy.md).
/// </summary>
public interface ITenantOwned
{
    Guid TenantId { get; }
}

/// <summary>Base entity with a UUIDv7 identity.</summary>
public abstract class Entity
{
    protected Entity(Guid id) => Id = id;

    public Guid Id { get; }
}

/// <summary>Aggregate root that collects domain events until the unit of work persists them to the outbox.</summary>
public abstract class AggregateRoot : Entity
{
    private readonly List<IDomainEvent> _events = [];

    protected AggregateRoot(Guid id)
        : base(id)
    {
    }

    public IReadOnlyList<IDomainEvent> DomainEvents => _events;

    protected void Raise(IDomainEvent domainEvent) => _events.Add(domainEvent);

    public void ClearDomainEvents() => _events.Clear();
}

/// <summary>Business-rule failure carrying a contract ErrorCode (packages/contracts/openapi/error-catalog.yaml).</summary>
public sealed record DomainError(string Code, string Message, IReadOnlyDictionary<string, object?>? Meta = null);

/// <summary>Result of an operation that can fail with a <see cref="DomainError"/> instead of throwing.</summary>
public readonly record struct Result<T>
{
    private Result(T? value, DomainError? error)
    {
        Value = value;
        Error = error;
    }

    public T? Value { get; }

    public DomainError? Error { get; }

    public bool IsSuccess => Error is null;

    public static Result<T> Success(T value) => new(value, null);

    public static Result<T> Failure(DomainError error) => new(default, error);
}
