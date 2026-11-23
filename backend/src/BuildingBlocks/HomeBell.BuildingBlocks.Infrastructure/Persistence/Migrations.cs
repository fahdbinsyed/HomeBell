using HomeBell.BuildingBlocks.Application;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace HomeBell.BuildingBlocks.Infrastructure.Persistence;

/// <summary>How the migrator builds a module's DbContext on the owner connection.</summary>
public sealed record ModuleDatabase(string Schema, Func<NpgsqlConnection, ModuleDbContext> CreateForMigrations);

public static class ModuleDatabaseRegistration
{
    /// <summary>
    /// Registers a module DbContext on the request's shared connection (with tenant filters + RLS session
    /// state) and records how to migrate it.
    /// </summary>
    public static IServiceCollection AddModuleDbContext<TContext>(
        this IServiceCollection services,
        string schema,
        Func<DbContextOptions<TContext>, ModuleDbDependencies?, TContext> create)
        where TContext : ModuleDbContext
    {
        ArgumentNullException.ThrowIfNull(create);
        services.AddScoped(sp =>
        {
            var deps = sp.GetRequiredService<ModuleDbDependencies>();
            var builder = new DbContextOptionsBuilder<TContext>();
            ModuleDbContext.ConfigureNpgsql(builder, deps, schema);
            return create(builder.Options, deps);
        });
        services.AddSingleton(new ModuleDatabase(schema, conn =>
        {
            var builder = new DbContextOptionsBuilder<TContext>()
                .UseNpgsql(conn, o => o.MigrationsHistoryTable("__ef_migrations", schema))
                .UseSnakeCaseNamingConvention();
            return create(builder.Options, null);
        }));
        return services;
    }
}

public static class RlsMigrationExtensions
{
    private const string TenantPredicate =
        "current_setting('app.cross_tenant', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid";

    /// <summary>ENABLE + FORCE row-level security with the tenant_isolation policy (02-multitenancy §4.5).</summary>
    public static void EnableTenantRls(this MigrationBuilder migrationBuilder, string schema, string table)
    {
        ArgumentNullException.ThrowIfNull(migrationBuilder);
        migrationBuilder.Sql($"ALTER TABLE {schema}.{table} ENABLE ROW LEVEL SECURITY;");
        migrationBuilder.Sql($"ALTER TABLE {schema}.{table} FORCE ROW LEVEL SECURITY;");
        migrationBuilder.Sql($"CREATE POLICY tenant_isolation ON {schema}.{table} USING ({TenantPredicate}) WITH CHECK ({TenantPredicate});");
    }

    public static void DisableTenantRls(this MigrationBuilder migrationBuilder, string schema, string table)
    {
        ArgumentNullException.ThrowIfNull(migrationBuilder);
        migrationBuilder.Sql($"DROP POLICY IF EXISTS tenant_isolation ON {schema}.{table};");
        migrationBuilder.Sql($"ALTER TABLE {schema}.{table} DISABLE ROW LEVEL SECURITY;");
    }
}

/// <summary>
/// Applies every module's migrations as the owner role, then (re)creates the restricted application role's
/// grants. The application role never owns tables and has no BYPASSRLS, so RLS always applies to it.
/// </summary>
public sealed partial class DatabaseMigrator(HomeBellDataSources sources, IEnumerable<ModuleDatabase> modules, ILogger<DatabaseMigrator> logger)
{
    public async Task MigrateAsync(CancellationToken ct)
    {
        var ownerCs = sources.OwnerConnectionString
            ?? throw new InvalidOperationException("ConnectionStrings:DatabaseOwner is required to run migrations.");
        var app = new NpgsqlConnectionStringBuilder(sources.AppConnectionString);
        var appRole = app.Username ?? throw new InvalidOperationException("App connection string needs a Username.");

        await using var conn = new NpgsqlConnection(ownerCs);
        await conn.OpenAsync(ct);
        await ExecAsync(conn, $"""
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{Ident(appRole)}') THEN
                CREATE ROLE "{Ident(appRole)}" LOGIN PASSWORD '{Literal(app.Password ?? string.Empty)}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
              END IF;
            END $$;
            """, ct);

        // Audit first: every other module maps (but does not create) audit.audit_log.
        var ordered = modules.OrderBy(m => m.Schema == "audit" ? 0 : 1).ThenBy(m => m.Schema, StringComparer.Ordinal).ToList();
        foreach (var module in ordered)
        {
            await using var db = module.CreateForMigrations(conn);
            var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
            if (pending.Count > 0)
            {
                LogMigrating(logger, module.Schema, pending.Count);
                await db.Database.MigrateAsync(ct);
            }
        }

        foreach (var schema in ordered.Select(m => m.Schema).Distinct(StringComparer.Ordinal))
        {
            await ExecAsync(conn, $"""
                CREATE SCHEMA IF NOT EXISTS {schema};
                GRANT USAGE ON SCHEMA {schema} TO "{Ident(appRole)}";
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {schema} TO "{Ident(appRole)}";
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO "{Ident(appRole)}";
                DO $$ BEGIN
                  IF to_regclass('{schema}.__ef_migrations') IS NOT NULL THEN
                    EXECUTE 'REVOKE ALL ON TABLE {schema}.__ef_migrations FROM "{Ident(appRole)}"';
                  END IF;
                END $$;
                """, ct);
        }

        // Append-only audit log (07-audit-outbox-workers §1).
        await ExecAsync(conn, $"""
            REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_log FROM "{Ident(appRole)}";
            GRANT SELECT, INSERT ON audit.audit_log TO "{Ident(appRole)}";
            """, ct);
    }

    private static async Task ExecAsync(NpgsqlConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static string Ident(string s) =>
        s.All(c => char.IsAsciiLetterOrDigit(c) || c == '_') ? s : throw new InvalidOperationException($"Unsafe role name '{s}'.");

    private static string Literal(string s) => s.Replace("'", "''", StringComparison.Ordinal);

    [LoggerMessage(Level = LogLevel.Information, Message = "Applying {Count} migration(s) to schema {Schema}")]
    private static partial void LogMigrating(ILogger logger, string schema, int count);
}

public static class PersistenceServiceCollectionExtensions
{
    /// <summary>Shared persistence services: data sources, per-request connection, tenant context, UoW, audit.</summary>
    public static IServiceCollection AddHomeBellPersistence(this IServiceCollection services, string appConnectionString, string? ownerConnectionString)
    {
        services.AddSingleton(new HomeBellDataSources(appConnectionString, ownerConnectionString));
        services.AddScoped<Tenancy.TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<Tenancy.TenantContext>());
        services.AddScoped<ConnectionScope>();
        services.AddScoped<TenantSessionInterceptor>();
        services.AddScoped<AuditBuffer>();
        services.AddScoped<ModuleDbDependencies>();
        services.AddScoped<IUnitOfWork, UnitOfWork>();
        services.AddScoped<AuditWriter>();
        services.AddScoped<IAuditWriter>(sp => sp.GetRequiredService<AuditWriter>());
        services.AddSingleton<DatabaseMigrator>();
        return services;
    }
}
