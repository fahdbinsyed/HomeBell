using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.Worker;

// Phase 0 skeleton. Outbox dispatcher, pickup timeouts, sweeps and retention jobs arrive in later phases
// (docs/architecture/07-audit-outbox-workers.md §4).
var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddModules(builder.Configuration, WorkerModules.All);

var host = builder.Build();
await host.RunAsync();
