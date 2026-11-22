using HomeBell.BuildingBlocks.Infrastructure;

namespace HomeBell.Api;

/// <summary>The single list of modules composed into the API and worker hosts.</summary>
internal static class Modules
{
    public static IReadOnlyList<IModule> All { get; } =
    [
        new HomeBell.Modules.Platform.Infrastructure.PlatformModule(),
        new HomeBell.Modules.Identity.Infrastructure.IdentityModule(),
        new HomeBell.Modules.Schools.Infrastructure.SchoolsModule(),
        new HomeBell.Modules.Guardians.Infrastructure.GuardiansModule(),
        new HomeBell.Modules.Dismissal.Infrastructure.DismissalModule(),
        new HomeBell.Modules.Billing.Infrastructure.BillingModule(),
        new HomeBell.Modules.Notifications.Infrastructure.NotificationsModule(),
        new HomeBell.Modules.Audit.Infrastructure.AuditModule(),
        new HomeBell.Modules.Reporting.Infrastructure.ReportingModule(),
    ];
}
