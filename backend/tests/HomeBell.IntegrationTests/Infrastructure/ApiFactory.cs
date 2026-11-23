using System.Collections.Concurrent;
using HomeBell.BuildingBlocks.Application;
using HomeBell.Modules.Identity.Contracts;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Testcontainers.PostgreSql;
using Testcontainers.Redis;

[assembly: AssemblyFixture(typeof(HomeBell.IntegrationTests.Infrastructure.ApiFactory))]

namespace HomeBell.IntegrationTests.Infrastructure;

/// <summary>
/// Boots the real API (Testing environment) against throwaway PostgreSQL 17 + Redis 7 containers. The
/// migrator runs as the owner (superuser); the API connects as the restricted homebell_app role, so RLS
/// applies exactly as in production.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string AppRolePassword = "test_app_password";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("homebell")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    private readonly RedisContainer _redis = new RedisBuilder("redis:7-alpine").Build();

    public TestClock Clock { get; } = new();

    public CapturingOtpSender Otp { get; } = new();

    public CapturingEmailSender Email { get; } = new();

    public string OwnerConnectionString => _postgres.GetConnectionString();

    public string AppConnectionString => new NpgsqlConnectionStringBuilder(OwnerConnectionString) { Username = "homebell_app", Password = AppRolePassword }.ConnectionString;

    public async ValueTask InitializeAsync()
    {
        await Task.WhenAll(_postgres.StartAsync(), _redis.StartAsync());
        _ = Services; // build the host now: runs migrations + demo seed (Program.cs)
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
        await _redis.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:DatabaseOwner", OwnerConnectionString);
        builder.UseSetting("ConnectionStrings:Database", AppConnectionString);
        builder.UseSetting("ConnectionStrings:Redis", _redis.GetConnectionString());
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("Seed:Demo", "true");
        builder.UseSetting("Otp:DevelopmentFixedCode", "000000");
        builder.UseSetting("Otp:AllowedCountryCodes:0", "+1");
        builder.UseSetting("Otp:AllowedCountryCodes:1", "+971");
        builder.UseSetting("Smtp:OtpDelivery", "smtp");
        builder.UseSetting("RateLimits:AuthPerMinute", "100000");
        builder.UseSetting("FileLogging:Directory", Path.Combine(Path.GetTempPath(), "homebell-test-logs"));
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IClock>();
            services.AddSingleton<IClock>(Clock);
            services.RemoveAll<IOtpSender>();
            services.AddSingleton<IOtpSender>(Otp);
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(Email);
        });
    }

    public ApiClient Api() => new(CreateClient());

    /// <summary>Runs SQL as the restricted application role (RLS applies). Returns the first column of the first row.</summary>
    public async Task<object?> ScalarAsAppAsync(string sql, string? tenantId = null, bool crossTenant = false)
    {
        await using var conn = new NpgsqlConnection(AppConnectionString);
        await conn.OpenAsync();
        await using (var set = new NpgsqlCommand("SELECT set_config('app.tenant_id', @t, false), set_config('app.cross_tenant', @c, false)", conn))
        {
            set.Parameters.AddWithValue("t", tenantId ?? string.Empty);
            set.Parameters.AddWithValue("c", crossTenant ? "on" : "off");
            await set.ExecuteNonQueryAsync();
        }

        await using var cmd = new NpgsqlCommand(sql, conn);
        return await cmd.ExecuteScalarAsync();
    }
}

/// <summary>Controllable clock; tests that travel in time must call <see cref="Reset"/> in a finally block.</summary>
public sealed class TestClock : IClock
{
    private TimeSpan _offset;

    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow + _offset;

    public void Advance(TimeSpan by) => _offset += by;

    public void Reset() => _offset = TimeSpan.Zero;
}

public sealed class CapturingOtpSender : IOtpSender
{
    public ConcurrentQueue<(string Phone, string Code, string Purpose)> Sent { get; } = new();

    public Task SendAsync(string phoneE164, string code, string purpose, CancellationToken cancellationToken)
    {
        Sent.Enqueue((phoneE164, code, purpose));
        return Task.CompletedTask;
    }

    public int CountFor(string phone) => Sent.Count(s => s.Phone == phone);
}

public sealed class CapturingEmailSender : IEmailSender
{
    public ConcurrentQueue<(string To, string Subject, string Body)> Sent { get; } = new();

    public Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
    {
        Sent.Enqueue((to, subject, textBody));
        return Task.CompletedTask;
    }
}
