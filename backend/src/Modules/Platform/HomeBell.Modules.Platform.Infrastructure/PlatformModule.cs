using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Platform.Domain;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Platform.Infrastructure;

/// <summary>Composition entry point of the Platform module (control plane).</summary>
public sealed class PlatformModule : IModule
{
    public string Name => "Platform";

    public string Schema => PlatformDbContext.SchemaName;

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
        services.AddModuleDbContext<PlatformDbContext>(Schema, (o, d) => new PlatformDbContext(o, d));
        services.AddScoped<ITenantDirectory, TenantDirectory>();
        services.AddScoped<EntitlementService>();
        services.AddScoped<PlatformSupport>();
        services.AddScoped<ITenantPlans, TenantPlans>();
        services.AddScoped<IEntitlements>(sp => sp.GetRequiredService<EntitlementService>());
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        TenantEndpoints.Map(endpoints);
        CatalogEndpoints.Map(endpoints);
        OpsEndpoints.Map(endpoints);
    }
}

public sealed class PlatformDbContext(DbContextOptions<PlatformDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "platform";

    public override string Schema => SchemaName;

    public DbSet<Tenant> Tenants => Set<Tenant>();

    public DbSet<TenantLifecycleHistory> LifecycleHistory => Set<TenantLifecycleHistory>();

    public DbSet<SubscriptionPlan> Plans => Set<SubscriptionPlan>();

    public DbSet<PlanVersion> PlanVersions => Set<PlanVersion>();

    public DbSet<TenantSubscription> Subscriptions => Set<TenantSubscription>();

    public DbSet<EntitlementOverride> Overrides => Set<EntitlementOverride>();

    public DbSet<FeatureFlag> FeatureFlags => Set<FeatureFlag>();

    public DbSet<SupportNote> Notes => Set<SupportNote>();

    public DbSet<SupportSession> SupportSessions => Set<SupportSession>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Tenant>(e =>
        {
            e.ToTable("tenant");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(64);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.LegalName).HasMaxLength(200);
            e.Property(x => x.Region).HasMaxLength(32);
            e.Property(x => x.Timezone).HasMaxLength(64);
            e.Property(x => x.CountryCode).HasMaxLength(2);
            e.Property(x => x.State).HasMaxLength(32);
            e.Property(x => x.PreviousOperationalState).HasMaxLength(32);
            e.Property(x => x.DataPlacement).HasMaxLength(16);
            e.Property(x => x.PlacementKey).HasMaxLength(64);
            e.Property(x => x.ContactName).HasMaxLength(120);
            e.Property(x => x.ContactEmail).HasMaxLength(254);
            e.Property(x => x.ContactPhone).HasMaxLength(16);
            e.Ignore(x => x.OperationalMode);
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<TenantLifecycleHistory>(e =>
        {
            e.ToTable("tenant_lifecycle_history");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.At });
            e.Property(x => x.Action).HasMaxLength(32);
            e.Property(x => x.FromState).HasMaxLength(32);
            e.Property(x => x.ToState).HasMaxLength(32);
            e.Property(x => x.ReasonCode).HasMaxLength(32);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.RefundStatus).HasMaxLength(32);
            Actor(e.OwnsOne(x => x.Actor));
        });
        modelBuilder.Entity<SubscriptionPlan>(e =>
        {
            e.ToTable("subscription_plan");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Code).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Description).HasMaxLength(1000);
        });
        modelBuilder.Entity<PlanVersion>(e =>
        {
            e.ToTable("plan_version");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.PlanId, x.Version }).IsUnique();
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.BillingPeriod).HasMaxLength(16);
            Json(e.Property(x => x.Features));
            Json(e.Property(x => x.Limits));
            e.Property<uint>("xmin").IsRowVersion();
        });
        modelBuilder.Entity<TenantSubscription>(e =>
        {
            e.ToTable("tenant_subscription");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.TenantId).IsUnique();
            e.Property(x => x.BillingReference).HasMaxLength(200);
            Actor(e.OwnsOne(x => x.CreatedBy));
        });
        modelBuilder.Entity<EntitlementOverride>(e =>
        {
            e.ToTable("entitlement_override");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.TenantId);
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.Key).HasMaxLength(64);
            e.Property(x => x.ValueJson).HasColumnType("jsonb");
            e.Property(x => x.ReasonCode).HasMaxLength(32);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.RevokeNote).HasMaxLength(2000);
            e.Ignore(x => x.BoolValue);
            e.Ignore(x => x.IntValue);
            Actor(e.OwnsOne(x => x.CreatedBy));
            Actor(e.OwnsOne(x => x.RevokedBy));
        });
        modelBuilder.Entity<FeatureFlag>(e =>
        {
            e.ToTable("feature_flag");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(64);
            e.Property(x => x.Description).HasMaxLength(500);
        });
        modelBuilder.Entity<SupportNote>(e =>
        {
            e.ToTable("support_note");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.CreatedAt });
            e.Property(x => x.Category).HasMaxLength(32);
            e.Property(x => x.Body).HasMaxLength(5000);
            e.Property(x => x.RefundStatus).HasMaxLength(32);
            Actor(e.OwnsOne(x => x.Author));
        });
        modelBuilder.Entity<SupportSession>(e =>
        {
            e.ToTable("support_session");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.StartedAt });
            e.Property(x => x.Reason).HasMaxLength(1000);
            e.Property(x => x.PlatformUserName).HasMaxLength(120);
        });
    }

    private static void Actor<TOwner>(OwnedNavigationBuilder<TOwner, ActorStamp> b)
        where TOwner : class
    {
        b.Property(x => x.Type).HasMaxLength(16);
        b.Property(x => x.DisplayName).HasMaxLength(120);
    }

    private static void Json<T>(PropertyBuilder<T> p)
        where T : class, new()
    {
        p.HasColumnType("jsonb").HasConversion(
            v => JsonSerializer.Serialize(v, JsonSerializerOptions.Default),
            v => JsonSerializer.Deserialize<T>(v, JsonSerializerOptions.Default) ?? new T(),
            new ValueComparer<T>(
                (a, b) => JsonSerializer.Serialize(a, JsonSerializerOptions.Default) == JsonSerializer.Serialize(b, JsonSerializerOptions.Default),
                v => JsonSerializer.Serialize(v, JsonSerializerOptions.Default).GetHashCode(StringComparison.Ordinal),
                v => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v, JsonSerializerOptions.Default), JsonSerializerOptions.Default)!));
    }
}

/// <summary>Tenant records are control-plane data (no RLS); reads are safe for any module.</summary>
internal sealed class TenantDirectory(PlatformDbContext db) : ITenantDirectory
{
    public async Task<TenantInfo?> FindAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var t = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        return t is null ? null : Map(t);
    }

    public async Task<IReadOnlyDictionary<Guid, TenantInfo>> GetManyAsync(IReadOnlyCollection<Guid> tenantIds, CancellationToken cancellationToken)
    {
        if (tenantIds.Count == 0)
        {
            return new Dictionary<Guid, TenantInfo>();
        }

        var list = await db.Tenants.AsNoTracking().Where(x => tenantIds.Contains(x.Id)).ToListAsync(cancellationToken);
        return list.ToDictionary(x => x.Id, Map);
    }

    private static TenantInfo Map(Tenant t) => new(t.Id, t.Name, t.Slug, t.State, t.OperationalMode, t.Timezone);
}

internal sealed class TenantPlans(PlatformDbContext db) : ITenantPlans
{
    public async Task<TenantPlanInfo?> FindAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var t = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        if (t is null)
        {
            return null;
        }

        var planName = await (from s in db.Subscriptions.AsNoTracking()
                              where s.TenantId == tenantId
                              join v in db.PlanVersions.AsNoTracking() on s.PlanVersionId equals v.Id
                              join p in db.Plans.AsNoTracking() on v.PlanId equals p.Id
                              select p.Name).FirstOrDefaultAsync(cancellationToken);
        return new TenantPlanInfo(planName, t.ExpiresAt, t.TermStart, t.TermEnd);
    }
}

/// <summary>Resolves effective entitlements (plan ⊕ lifecycle ⊕ overrides ⊕ flags) with usage counts.</summary>
public sealed class EntitlementService(PlatformDbContext db, ISchoolStats schools, IClock clock) : IEntitlements
{
    public async Task<EffectiveEntitlementsInfo> ResolveAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken) ?? throw Problem.NotFound();
        var sub = await db.Subscriptions.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        var plan = sub is null ? null : await db.PlanVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == sub.PlanVersionId, cancellationToken);
        var overrides = await db.Overrides.AsNoTracking().Where(o => o.TenantId == tenantId).ToListAsync(cancellationToken);
        var flags = await db.FeatureFlags.AsNoTracking().ToListAsync(cancellationToken);
        var usage = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            [LimitKey.StudentsMax] = await schools.ActiveStudentsAsync(tenantId, cancellationToken),
            [LimitKey.StaffMax] = await schools.ActiveStaffAsync(tenantId, cancellationToken),
            [LimitKey.DisplaysMax] = await schools.ActiveDisplaysAsync(tenantId, cancellationToken),
        };
        var now = clock.UtcNow;
        var r = EntitlementResolver.Resolve(tenant, plan, overrides, flags, usage, now);
        return new EffectiveEntitlementsInfo(
            tenantId, r.State, r.OperationalMode,
            r.Features.Select(f => new EffectiveFeatureInfo(f.Key, f.Enabled, f.Source, f.OverrideId, f.ExpiresAt)).ToList(),
            r.Limits.Select(l => new EffectiveLimitInfo(l.Key, l.Value, l.Used, l.Source, l.OverrideId, l.ExpiresAt)).ToList(),
            now);
    }

    public async Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken cancellationToken) =>
        (await ResolveAsync(tenantId, cancellationToken)).Features.FirstOrDefault(f => f.Key == featureKey)?.Enabled ?? false;
}

internal sealed class PlatformDesignTimeFactory : IDesignTimeDbContextFactory<PlatformDbContext>
{
    public PlatformDbContext CreateDbContext(string[] args) => new(DesignTime.Options<PlatformDbContext>(PlatformDbContext.SchemaName), null);
}
