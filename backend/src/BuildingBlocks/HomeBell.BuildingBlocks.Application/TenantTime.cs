using NodaTime;

namespace HomeBell.BuildingBlocks.Application;

/// <summary>
/// Tenant-local wall-clock time (02-multitenancy §6: the tenant's IANA timezone drives dismissal windows,
/// "today" and day boundaries). Uses NodaTime's embedded IANA database so results are identical on Windows,
/// Linux and containers, independent of OS time-zone data or ICU. Unknown zones fall back to UTC.
/// </summary>
public static class TenantTime
{
    public static DateTimeZone Zone(string? timezone) =>
        timezone is not null && DateTimeZoneProviders.Tzdb.GetZoneOrNull(timezone) is { } zone ? zone : DateTimeZone.Utc;

    public static bool IsKnownZone(string? timezone) => timezone is not null && DateTimeZoneProviders.Tzdb.GetZoneOrNull(timezone) is not null;

    /// <summary>Local date, time and ISO day of week (1 = Monday) in the tenant's zone.</summary>
    public static (DateOnly Date, TimeOnly Time, int IsoDayOfWeek) Local(string? timezone, DateTimeOffset now)
    {
        var local = Instant.FromDateTimeOffset(now).InZone(Zone(timezone)).LocalDateTime;
        return (local.Date.ToDateOnly(), local.TimeOfDay.ToTimeOnly(), (int)local.DayOfWeek);
    }

    public static DateOnly Today(string? timezone, DateTimeOffset now) => Local(timezone, now).Date;

    /// <summary>The instant of a tenant-local wall time (DST gaps resolve forward, overlaps to the earlier instant).</summary>
    public static DateTimeOffset ToInstant(string? timezone, DateOnly date, TimeOnly time)
    {
        var local = new LocalDateTime(date.Year, date.Month, date.Day, time.Hour, time.Minute, time.Second);
        return local.InZoneLeniently(Zone(timezone)).ToDateTimeOffset().ToUniversalTime();
    }
}
