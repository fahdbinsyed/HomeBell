using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Notifications.Contracts;
using HomeBell.Modules.Notifications.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.Modules.Notifications.Infrastructure;

/// <summary>Composition entry point of the Notifications module.</summary>
public sealed class NotificationsModule : IModule
{
    public string Name => "Notifications";

    public string Schema => NotificationsDbContext.SchemaName;

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
        services.AddModuleDbContext<NotificationsDbContext>(Schema, (o, d) => new NotificationsDbContext(o, d));
        services.AddScoped<INotifier, Notifier>();
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var me = endpoints.MapGroup("/v1/me");

        me.MapGet("/notifications", async (bool? unreadOnly, int? limit, string? cursor, ICurrentActor actor, NotificationsDbContext db, CancellationToken ct) =>
        {
            var userId = actor.Id!.Value;
            var take = Paging.Limit(limit);
            var skip = Paging.Offset(cursor);
            var mine = db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
            var rows = await mine.Where(n => unreadOnly != true || n.ReadAt == null)
                .OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Skip(skip).Take(take + 1).ToListAsync(ct);
            var unread = await mine.CountAsync(n => n.ReadAt == null, ct);
            return new NotificationPageDto(rows.Take(take).Select(Dto).ToList(), unread, Paging.Next(skip, take, rows.Count), take);
        }).RequireGuardian();

        me.MapPost("/notifications/read", async (MarkReadRequest b, ICurrentActor actor, NotificationsDbContext db, IClock clock, CancellationToken ct) =>
        {
            new Validator()
                .Must(b.All == true || b.Ids is { Count: > 0 }, "ids", "required", "Give ids or all: true.")
                .Must(b.Ids is null || b.Ids.Count <= 100, "ids", "max_items", "At most 100 ids.")
                .ThrowIfInvalid();
            var userId = actor.Id!.Value;
            var query = db.Notifications.Where(n => n.UserId == userId && n.ReadAt == null);
            if (b.All != true)
            {
                query = query.Where(n => b.Ids!.Contains(n.Id));
            }

            foreach (var n in await query.ToListAsync(ct))
            {
                n.MarkRead(clock.UtcNow);
            }

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireGuardian();

        me.MapPost("/push-tokens", async (PushTokenRegistration b, ICurrentActor actor, NotificationsDbContext db, IClock clock, CancellationToken ct) =>
        {
            new Validator()
                .Required("provider", b.Provider).OneOf("provider", b.Provider, PushProvider.All)
                .Required("token", b.Token).MaxLength("token", b.Token, 4096)
                .ThrowIfInvalid();
            var (userId, install) = (actor.Id!.Value, actor.DeviceId!.Value);
            var existing = await db.PushTokens.FirstOrDefaultAsync(p => p.UserId == userId && p.DeviceInstallId == install, ct);
            if (existing is null)
            {
                db.PushTokens.Add(new PushToken(Guid.CreateVersion7(), userId, install, b.Provider!, b.Token!, clock.UtcNow));
            }
            else
            {
                existing.Replace(b.Provider!, b.Token!, clock.UtcNow);
            }

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireGuardian();

        me.MapDelete("/push-tokens/current", async (ICurrentActor actor, NotificationsDbContext db, CancellationToken ct) =>
        {
            var (userId, install) = (actor.Id!.Value, actor.DeviceId!.Value);
            db.PushTokens.RemoveRange(await db.PushTokens.Where(p => p.UserId == userId && p.DeviceInstallId == install).ToListAsync(ct));
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireGuardian();
    }

    private static NotificationDto Dto(Notification n) =>
        new(n.Id, n.Type, n.TenantId, n.Title, n.Body, JsonSerializer.Deserialize<Dictionary<string, string>>(n.DataJson) ?? [], n.CreatedAt, n.ReadAt);
}

public sealed record NotificationDto(Guid Id, string Type, Guid? TenantId, string Title, string Body, Dictionary<string, string> Data, DateTimeOffset CreatedAt, DateTimeOffset? ReadAt);

public sealed record NotificationPageDto(IReadOnlyList<NotificationDto> Items, int UnreadCount, string? NextCursor, int Limit);

public sealed record MarkReadRequest(List<Guid>? Ids, bool? All);

public sealed record PushTokenRegistration(string? Provider, string? Token);

public sealed class NotificationsDbContext(DbContextOptions<NotificationsDbContext> options, ModuleDbDependencies? deps) : ModuleDbContext(options, deps)
{
    public const string SchemaName = "notifications";

    public override string Schema => SchemaName;

    public DbSet<Notification> Notifications => Set<Notification>();

    public DbSet<PushToken> PushTokens => Set<PushToken>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Notification>(e =>
        {
            e.ToTable("notification");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.Property(x => x.Type).HasMaxLength(40);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Body).HasMaxLength(1000);
            e.Property(x => x.DataJson).HasColumnType("jsonb");
        });
        modelBuilder.Entity<PushToken>(e =>
        {
            e.ToTable("push_token");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.DeviceInstallId }).IsUnique();
            e.Property(x => x.Provider).HasMaxLength(16);
            e.Property(x => x.Token).HasMaxLength(4096);
        });
    }
}

internal sealed class Notifier(NotificationsDbContext db, IClock clock) : INotifier
{
    public async Task<Guid> NotifyAsync(Guid userId, Guid? tenantId, string type, string title, string body, IReadOnlyDictionary<string, string>? data, CancellationToken cancellationToken)
    {
        var n = new Notification(Guid.CreateVersion7(), userId, tenantId, type, title, body, JsonSerializer.Serialize(data ?? new Dictionary<string, string>()), clock.UtcNow);
        db.Notifications.Add(n);
        await db.SaveChangesAsync(cancellationToken);
        return n.Id;
    }
}

internal sealed class NotificationsDesignTimeFactory : IDesignTimeDbContextFactory<NotificationsDbContext>
{
    public NotificationsDbContext CreateDbContext(string[] args) => new(DesignTime.Options<NotificationsDbContext>(NotificationsDbContext.SchemaName), null);
}
