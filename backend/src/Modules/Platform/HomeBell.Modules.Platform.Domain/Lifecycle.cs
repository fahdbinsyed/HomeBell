using HomeBell.BuildingBlocks.Domain.Contract;
using A = HomeBell.BuildingBlocks.Domain.Contract.TenantLifecycleAction;
using S = HomeBell.BuildingBlocks.Domain.Contract.TenantLifecycleState;

namespace HomeBell.Modules.Platform.Domain;

/// <summary>
/// Lifecycle transition table (docs/architecture/05-entitlements-lifecycle.md §5). Identical to
/// packages/mocks/src/rules/lifecycle.ts; the server is authoritative.
/// </summary>
public static class LifecycleRules
{
    private const string Same = "(same)";
    private const string Previous = "(previous)";

    private static readonly string[] Operational = [S.Trial, S.PilotFree, S.ActivePaid, S.ManualOverride];

    private static readonly Dictionary<string, (string[] From, string To)> Table = new(StringComparer.Ordinal)
    {
        [A.StartTrial] = ([S.Draft, S.Expired], S.Trial),
        [A.GrantFree] = ([S.Draft, S.Trial, S.Expired, S.ActivePaid], S.PilotFree),
        [A.Activate] = ([S.Draft], S.ActivePaid),
        [A.ConvertToPaid] = ([S.Trial, S.PilotFree, S.ManualOverride, S.Expired], S.ActivePaid),
        [A.ApplyManualOverride] = ([S.Trial, S.PilotFree, S.ActivePaid, S.Expired, S.Suspended], S.ManualOverride),
        [A.ExtendExpiry] = ([S.Trial, S.PilotFree, S.ActivePaid, S.ManualOverride], Same),
        [A.Suspend] = ([S.Trial, S.PilotFree, S.ActivePaid, S.ManualOverride, S.Expired], S.Suspended),
        [A.Deactivate] = ([S.Trial, S.PilotFree, S.ActivePaid, S.ManualOverride, S.Expired, S.Suspended], S.Deactivated),
        [A.Cancel] = ([S.Trial, S.PilotFree, S.ActivePaid, S.ManualOverride, S.Expired, S.Suspended, S.Deactivated], S.Cancelled),
        [A.StartOffboarding] = ([S.Cancelled, S.Deactivated], S.Offboarding),
        [A.Reinstate] = ([S.Suspended, S.Deactivated, S.Cancelled], Previous),
    };

    public static IReadOnlyList<string> ActionsRequiringExpiry { get; } = [A.StartTrial, A.Activate, A.ConvertToPaid, A.ExtendExpiry];

    public static IReadOnlyList<string> ActionsRequiringNameConfirmation { get; } = [A.Deactivate, A.Cancel, A.StartOffboarding];

    public static IReadOnlyList<string> AllowedActions(string state) =>
        A.All.Where(a => Table[a].From.Contains(state, StringComparer.Ordinal)).ToList();

    public static bool IsAllowed(string action, string state) =>
        Table.TryGetValue(action, out var rule) && rule.From.Contains(state, StringComparer.Ordinal);

    public static string TargetState(string action, string current, string? previous, string? explicitTarget)
    {
        var to = Table[action].To;
        return to switch
        {
            Same => current,
            Previous => explicitTarget ?? (previous is not null && Operational.Contains(previous) ? previous : S.ActivePaid),
            _ => to,
        };
    }

    /// <summary>Remember the last operational state when leaving operation (for reinstate).</summary>
    public static bool RemembersPrevious(string action) => action is A.Suspend or A.Deactivate or A.Cancel;
}

/// <summary>
/// EntitlementResolver (05-entitlements-lifecycle.md §3): plan ⊕ lifecycle gate ⊕ overrides ⊕ flags, each
/// value carrying its source. Same algorithm as packages/mocks/src/rules/entitlements.ts.
/// </summary>
public static class EntitlementResolver
{
    public sealed record Feature(string Key, bool Enabled, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

    public sealed record Limit(string Key, int? Value, int? Used, string Source, Guid? OverrideId, DateTimeOffset? ExpiresAt);

    public sealed record Result(string State, string OperationalMode, IReadOnlyList<Feature> Features, IReadOnlyList<Limit> Limits);

    private static readonly string[] FutureFeaturePrefixes = ["audio.", "qr.", "campus.", "sso."];

    public static Result Resolve(
        Tenant tenant,
        PlanVersion? plan,
        IReadOnlyList<EntitlementOverride> overrides,
        IReadOnlyList<FeatureFlag> flags,
        IReadOnlyDictionary<string, int> usage,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(tenant);
        ArgumentNullException.ThrowIfNull(overrides);
        ArgumentNullException.ThrowIfNull(flags);
        ArgumentNullException.ThrowIfNull(usage);
        var active = overrides.Where(o => o.IsActive(now)).OrderBy(o => o.CreatedAt).ToList();
        var mode = tenant.OperationalMode;
        var trialLike = tenant.State is TenantLifecycleState.Trial or TenantLifecycleState.PilotFree;

        var features = FeatureKey.All.Select(key =>
        {
            var ov = active.LastOrDefault(o => o.Kind == EntitlementKind.Feature && o.Key == key);
            bool enabled;
            string source;
            if (plan is not null && plan.Features.TryGetValue(key, out var planValue))
            {
                (enabled, source) = (planValue, EntitlementSource.Plan);
            }
            else
            {
                (enabled, source) = (trialLike && !FutureFeaturePrefixes.Any(p => key.StartsWith(p, StringComparison.Ordinal)),
                    plan is null ? EntitlementSource.Default : EntitlementSource.Plan);
            }

            if (ov is not null)
            {
                (enabled, source) = (ov.BoolValue, EntitlementSource.Override);
            }

            var flag = flags.FirstOrDefault(f => f.Key == key);
            if (flag is not null && !flag.IsEnabledFor(tenant.Id))
            {
                (enabled, source) = (false, EntitlementSource.Flag);
            }

            if (mode != OperationalMode.Full && key.StartsWith("dismissal.", StringComparison.Ordinal))
            {
                (enabled, source) = (false, EntitlementSource.Lifecycle);
            }

            return new Feature(key, enabled, source, ov?.Id, ov?.ExpiresAt);
        }).ToList();

        var limits = LimitKey.All.Select(key =>
        {
            var ov = active.LastOrDefault(o => o.Kind == EntitlementKind.Limit && o.Key == key);
            int? planValue = plan is not null && plan.Limits.TryGetValue(key, out var pl) ? pl : (key == LimitKey.StudentsMax ? 500 : null);
            var value = ov is not null ? ov.IntValue : planValue;
            var source = ov is not null ? EntitlementSource.Override : plan is not null ? EntitlementSource.Plan : EntitlementSource.Default;
            return new Limit(key, value, usage.TryGetValue(key, out var u) ? u : null, source, ov?.Id, ov?.ExpiresAt);
        }).ToList();

        return new Result(tenant.State, mode, features, limits);
    }
}
