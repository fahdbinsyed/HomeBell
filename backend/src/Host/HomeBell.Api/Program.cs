using System.Threading.RateLimiting;
using HomeBell.Api;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using HomeBell.BuildingBlocks.Infrastructure.Logging;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using Microsoft.AspNetCore.HttpOverrides;
using Serilog;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddHomeBellLogging(config, builder.Environment);
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddHomeBellPersistence(
    config.GetConnectionString("Database") ?? throw new InvalidOperationException("ConnectionStrings:Database is required."),
    config.GetConnectionString("DatabaseOwner"));
builder.Services.AddHomeBellAuth(config, config.GetConnectionString("Redis") ?? "localhost:6379");
builder.Services.ConfigureHttpJsonOptions(o => JsonDefaults.Configure(o.SerializerOptions));
builder.Services.AddRateLimiter(o =>
{
    var perMinute = config.GetValue("RateLimits:AuthPerMinute", 20);
    o.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.OnRejected = (ctx, ct) => new ValueTask(ProblemWriter.WriteAsync(ctx.HttpContext, ErrorCodes.RateLimited,
        meta: new Dictionary<string, object?> { ["retryAfterSeconds"] = 60 }));
});
builder.Services.Configure<ForwardedHeadersOptions>(o => o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
builder.Services.AddModules(config, Modules.All);
builder.Services.AddScoped<DevSeeder>();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseSerilogRequestLogging();
app.UseContractProblems();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseIdempotency();
app.Use(async (http, next) =>
{
    await next(http);
    // Audit rows written by handlers that did not SaveChanges afterwards.
    await http.RequestServices.GetRequiredService<AuditWriter>().FlushAsync(http.RequestAborted);
});

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapModules(Modules.All);

if (config.GetValue("Database:MigrateOnStartup", app.Environment.IsDevelopment()) || args.Contains("--migrate"))
{
    await app.Services.GetRequiredService<DatabaseMigrator>().MigrateAsync(CancellationToken.None);
    if (config.GetValue("Seed:Demo", false))
    {
        await using var scope = app.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<DevSeeder>().SeedAsync(CancellationToken.None);
    }

    if (args.Contains("--migrate"))
    {
        return;
    }
}

LogHelper.WriteLine(AppLogLevel.Info, Guid.CreateVersion7(), $"HomeBell API starting ({app.Environment.EnvironmentName})");
await app.RunAsync();

/// <summary>Entry point marker for WebApplicationFactory in integration tests.</summary>
public partial class Program;
