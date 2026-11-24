using System.Globalization;
using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Modules.Schools.Infrastructure;

/// <summary>Settings other modules act on; defaults apply until the school saves its settings.</summary>
internal sealed class SchoolSettingsReader(SchoolsDbContext db, ITenantContext tenant, ITenantDirectory tenants) : ISchoolSettingsReader
{
    public async Task<SchoolSettingsInfo> GetAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        TenantSettingsDto dto;
        using (tenant.Scope(tenantId))
        {
            var record = await db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
            dto = record is not null
                ? JsonSerializer.Deserialize<TenantSettingsDto>(record.Json, JsonDefaults.Options)!
                : TenantSettingsDto.Default((await tenants.FindAsync(tenantId, cancellationToken))?.Name ?? "School");
        }

        var windows = dto.Dismissal.Windows
            .Select(w => new DismissalWindowInfo(w.DayOfWeek,
                TimeOnly.ParseExact(w.OpensAt, "HH:mm", CultureInfo.InvariantCulture),
                TimeOnly.ParseExact(w.ClosesAt, "HH:mm", CultureInfo.InvariantCulture)))
            .ToList();
        return new SchoolSettingsInfo(windows, dto.LocationRule.Enabled, dto.Branding.LogoUrl, dto.Branding.PrimaryColor);
    }
}
