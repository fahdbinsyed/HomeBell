using System.Text.RegularExpressions;
using HomeBell.BuildingBlocks.Domain.Contract;
using P = HomeBell.BuildingBlocks.Domain.Contract.Permission;

namespace HomeBell.BuildingBlocks.Application;

/// <summary>
/// Role → permission bundles (docs/architecture/03-identity-auth-otp-devices.md §5). Kept identical to
/// packages/mocks/src/rules/permissions.ts; the server is the only enforcement point.
/// </summary>
public static class RolePermissions
{
    private static readonly Dictionary<string, string[]> School = new(StringComparer.Ordinal)
    {
        [SchoolRole.SchoolAdmin] =
        [
            P.SchoolSettingsRead, P.SchoolSettingsWrite, P.SchoolStaffManage, P.SchoolStudentsRead,
            P.SchoolStudentsWrite, P.SchoolImportsWrite, P.SchoolGuardiansRead, P.SchoolGuardiansWrite,
            P.SchoolGuardiansBlock, P.SchoolDevicesOverride, P.SchoolDisplaysManage, P.SchoolQueueRead,
            P.SchoolQueueDispatch, P.SchoolQueueResolve, P.SchoolReportsRead, P.SchoolReportsExport,
            P.SchoolAuditRead, P.SchoolSubscriptionRead,
        ],
        [SchoolRole.SchoolDispatcher] =
        [
            P.SchoolQueueRead, P.SchoolQueueDispatch, P.SchoolQueueResolve, P.SchoolStudentsRead,
            P.SchoolGuardiansRead,
        ],
        [SchoolRole.SchoolFrontDesk] = [P.SchoolQueueRead, P.SchoolQueueDispatch, P.SchoolStudentsRead],
        [SchoolRole.SchoolReporting] = [P.SchoolReportsRead, P.SchoolReportsExport, P.SchoolAuditRead, P.SchoolQueueRead],
    };

    private static readonly Dictionary<string, string[]> Platform = new(StringComparer.Ordinal)
    {
        [PlatformRole.PlatformSuperAdmin] =
        [
            P.PlatformTenantsRead, P.PlatformTenantsWrite, P.PlatformLifecycleWrite, P.PlatformPlansRead,
            P.PlatformPlansWrite, P.PlatformSubscriptionsWrite, P.PlatformOverridesWrite, P.PlatformFlagsWrite,
            P.PlatformNotesRead, P.PlatformNotesWrite, P.PlatformAuditRead, P.PlatformUsersManage,
            P.PlatformSupportSessionsCreate, P.PlatformDevicesOverride,
        ],
        [PlatformRole.PlatformOpsAdmin] =
        [
            P.PlatformTenantsRead, P.PlatformTenantsWrite, P.PlatformLifecycleWrite, P.PlatformPlansRead,
            P.PlatformNotesRead, P.PlatformNotesWrite, P.PlatformAuditRead, P.PlatformSupportSessionsCreate,
            P.PlatformDevicesOverride,
        ],
        [PlatformRole.PlatformBillingOps] =
        [
            P.PlatformTenantsRead, P.PlatformPlansRead, P.PlatformPlansWrite, P.PlatformSubscriptionsWrite,
            P.PlatformOverridesWrite, P.PlatformNotesRead, P.PlatformNotesWrite,
        ],
        [PlatformRole.PlatformSupportAnalyst] =
        [
            P.PlatformTenantsRead, P.PlatformPlansRead, P.PlatformNotesRead, P.PlatformAuditRead,
            P.PlatformSupportSessionsCreate,
        ],
    };

    /// <summary>Read-only subset granted to a platform support session inside one tenant.</summary>
    private static readonly string[] SupportReadOnly =
    [
        P.SchoolSettingsRead, P.SchoolStudentsRead, P.SchoolGuardiansRead, P.SchoolQueueRead,
        P.SchoolReportsRead, P.SchoolAuditRead, P.SchoolSubscriptionRead,
    ];

    public static IReadOnlyList<string> ForSchoolRole(string role) =>
        School.TryGetValue(role, out var p) ? p : [];

    public static IReadOnlyList<string> ForPlatformRoles(IEnumerable<string> roles) =>
        roles.SelectMany(r => Platform.TryGetValue(r, out var p) ? p : []).Distinct(StringComparer.Ordinal).ToList();

    public static IReadOnlyList<string> ForSupportSession() => SupportReadOnly;
}

public static partial class Phone
{
    [GeneratedRegex(@"^\+[1-9]\d{6,14}$")]
    public static partial Regex E164();

    /// <summary>"+15550100001" → "+1•••••0001" (country code + last 4; docs/architecture/08 §5).</summary>
    public static string Mask(string e164)
    {
        ArgumentNullException.ThrowIfNull(e164);
        if (e164.Length < 8)
        {
            return "•••••";
        }

        var cc = CountryCode(e164);
        return $"{cc}•••••{e164[^4..]}";
    }

    /// <summary>Best-effort country calling code: +1 (NANP) or the first 2–3 digits.</summary>
    public static string CountryCode(string e164)
    {
        ArgumentNullException.ThrowIfNull(e164);
        if (e164.StartsWith("+1", StringComparison.Ordinal))
        {
            return "+1";
        }

        string[] threeDigit = ["+971", "+966", "+974", "+973", "+968", "+965", "+353", "+351", "+358"];
        var three = threeDigit.FirstOrDefault(p => e164.StartsWith(p, StringComparison.Ordinal));
        return three ?? e164[..3];
    }
}
