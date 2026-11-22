using HomeBell.Api;
using HomeBell.BuildingBlocks.Infrastructure;

// Phase 0 skeleton: composition only. Auth, tenancy, rate limiting, idempotency, SignalR, Serilog and
// OpenTelemetry are wired in Phase 2 per docs/architecture/01-backend-modules.md §5.
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddModules(builder.Configuration, Modules.All);

var app = builder.Build();

app.UseExceptionHandler();

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapModules(Modules.All);

await app.RunAsync();
