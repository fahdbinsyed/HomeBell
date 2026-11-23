using Microsoft.EntityFrameworkCore;

namespace HomeBell.BuildingBlocks.Infrastructure.Persistence;

/// <summary>
/// Options for <c>dotnet ef migrations add</c>. Generating migrations needs no live database; the
/// connection string is a placeholder (override with HOMEBELL_DESIGN_DB to run <c>dotnet ef database …</c>).
/// </summary>
public static class DesignTime
{
    public static DbContextOptions<TContext> Options<TContext>(string schema)
        where TContext : DbContext =>
        new DbContextOptionsBuilder<TContext>()
            .UseNpgsql(
                Environment.GetEnvironmentVariable("HOMEBELL_DESIGN_DB") ?? "Host=localhost;Port=5433;Database=homebell;Username=homebell_owner",
                o => o.MigrationsHistoryTable("__ef_migrations", schema))
            .UseSnakeCaseNamingConvention()
            .Options;
}
