using System.Linq.Expressions;
using System.Reflection;
using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HomeBell.BuildingBlocks.Infrastructure.Persistence;

/// <summary>Ambient services every module DbContext needs (one scoped instance per request).</summary>
public sealed class ModuleDbDependencies(ITenantContext tenant, ConnectionScope connection, AuditBuffer audit, TenantSessionInterceptor interceptor)
{
    public ITenantContext Tenant { get; } = tenant;

    public ConnectionScope Connection { get; } = connection;

    public AuditBuffer Audit { get; } = audit;

    public TenantSessionInterceptor Interceptor { get; } = interceptor;
}

/// <summary>
/// Base for every module DbContext: own schema, snake_case names, tenant query filters on every
/// <see cref="ITenantOwned"/> entity, a cross-tenant write guard, and audit rows flushed into the same
/// SaveChanges (docs/architecture/01-backend-modules.md §4, 02-multitenancy.md §4).
/// </summary>
public abstract class ModuleDbContext : DbContext
{
    private readonly ModuleDbDependencies? _deps;

    protected ModuleDbContext(DbContextOptions options, ModuleDbDependencies? deps)
        : base(options)
    {
        _deps = deps;
    }

    /// <summary>PostgreSQL schema owned by the module.</summary>
    public abstract string Schema { get; }

    /// <summary>Only the Audit module's migrations create the shared audit table.</summary>
    protected virtual bool OwnsAuditTable => false;

    public DbSet<AuditLogRecord> AuditLog => Set<AuditLogRecord>();

    // Referenced by query filters; EF evaluates them per context instance.
    protected Guid? CurrentTenantId => _deps?.Tenant.TenantId;

    protected bool CrossTenantActive => _deps?.Tenant.IsCrossTenant ?? true;

    public static void ConfigureNpgsql(DbContextOptionsBuilder builder, ModuleDbDependencies deps, string schema)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentNullException.ThrowIfNull(deps);
        builder
            .UseNpgsql(deps.Connection.Connection, o => o.MigrationsHistoryTable("__ef_migrations", schema))
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(deps.Interceptor);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        modelBuilder.HasDefaultSchema(Schema);
        modelBuilder.Entity<AuditLogRecord>(e =>
        {
            e.ToTable("audit_log", "audit", t =>
            {
                if (!OwnsAuditTable)
                {
                    t.ExcludeFromMigrations();
                }
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.Data).HasColumnType("jsonb");
            e.Property(x => x.Action).HasMaxLength(64);
            e.Property(x => x.Outcome).HasMaxLength(16);
            e.Property(x => x.ActorType).HasMaxLength(16);
            e.HasIndex(x => new { x.TenantId, x.OccurredAt });
            e.HasIndex(x => x.OccurredAt);
        });

        ConfigureModel(modelBuilder);

        foreach (var entity in modelBuilder.Model.GetEntityTypes().ToList())
        {
            if (typeof(AggregateRoot).IsAssignableFrom(entity.ClrType))
            {
                modelBuilder.Entity(entity.ClrType).Ignore(nameof(AggregateRoot.DomainEvents));
            }

            if (typeof(ITenantOwned).IsAssignableFrom(entity.ClrType) && entity.BaseType is null)
            {
                ApplyTenantFilterMethod.MakeGenericMethod(entity.ClrType).Invoke(this, [modelBuilder]);
            }
        }
    }

    protected abstract void ConfigureModel(ModelBuilder modelBuilder);

    private static readonly MethodInfo ApplyTenantFilterMethod =
        typeof(ModuleDbContext).GetMethod(nameof(ApplyTenantFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;

    private void ApplyTenantFilter<T>(ModelBuilder modelBuilder)
        where T : class, ITenantOwned
    {
        Expression<Func<T, bool>> filter = e => CrossTenantActive || e.TenantId == CurrentTenantId;
        modelBuilder.Entity<T>().HasQueryFilter(filter);
    }

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        BeforeSave();
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        BeforeSave();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    private void BeforeSave()
    {
        if (_deps is null)
        {
            return;
        }

        // Join the request's unit-of-work transaction, if one is open.
        if (_deps.Connection.Transaction is { } tx && Database.CurrentTransaction?.GetDbTransaction() != tx)
        {
            Database.UseTransaction(tx);
            _deps.Connection.Enlisted.Add(this);
        }

        GuardTenantWrites();
        foreach (var record in _deps.Audit.Drain())
        {
            AuditLog.Add(record);
        }
    }

    private void GuardTenantWrites()
    {
        var tenant = _deps!.Tenant;
        foreach (var entry in ChangeTracker.Entries<ITenantOwned>())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted))
            {
                continue;
            }

            if (tenant.IsCrossTenant)
            {
                continue;
            }

            if (tenant.TenantId is not { } current || entry.Entity.TenantId != current)
            {
                throw new InvalidOperationException(
                    $"Cross-tenant write blocked: {entry.Metadata.ClrType.Name} belongs to tenant {entry.Entity.TenantId}, request tenant is {tenant.TenantId?.ToString() ?? "unresolved"}.");
            }
        }
    }
}

/// <summary>Row of the append-only audit.audit_log table (docs/architecture/07-audit-outbox-workers.md §1).</summary>
public sealed class AuditLogRecord
{
    public Guid Id { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public Guid? TenantId { get; set; }

    public string ActorType { get; set; } = "system";

    public Guid? ActorId { get; set; }

    public string ActorDisplay { get; set; } = "System";

    public Guid? OnBehalfOf { get; set; }

    public string Action { get; set; } = string.Empty;

    public string? TargetType { get; set; }

    public string? TargetId { get; set; }

    public string Outcome { get; set; } = "success";

    public string? ReasonCode { get; set; }

    public string? IpHash { get; set; }

    public string? UserAgent { get; set; }

    public Guid? DeviceId { get; set; }

    public string? RequestId { get; set; }

    public string Data { get; set; } = "{}";
}

/// <summary>Request-scoped buffer of audit rows; the next module SaveChanges persists them.</summary>
public sealed class AuditBuffer
{
    private readonly List<AuditLogRecord> _pending = [];

    public void Add(AuditLogRecord record) => _pending.Add(record);

    public IReadOnlyList<AuditLogRecord> Drain()
    {
        var copy = _pending.ToList();
        _pending.Clear();
        return copy;
    }

    public static string Serialize(IReadOnlyDictionary<string, object?>? data) =>
        data is null ? "{}" : JsonSerializer.Serialize(data, JsonDefaults.Options);
}
