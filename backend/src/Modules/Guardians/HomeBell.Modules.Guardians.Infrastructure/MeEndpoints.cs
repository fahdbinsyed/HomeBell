using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Guardians.Domain;
using HomeBell.Modules.Platform.Contracts;
using HomeBell.Modules.Schools.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Modules.Guardians.Infrastructure;

public sealed record PickupEligibilityDto(bool Eligible, string? ReasonCode, DateTimeOffset? WindowOpensAt, DateTimeOffset? WindowClosesAt, bool LocationRequired);

public sealed record ChildSummaryDto(
    Guid StudentId, Guid TenantId, string TenantName, string FirstName, string LastName, string? PreferredName, string ClassName, string? SectionName,
    string Relationship, string MyRole, PickupEligibilityDto Pickup, object? ActiveRequest);

public sealed record GuardianTenantContextDto(
    Guid TenantId, string TenantName, string OperationalMode, Guid GuardianId, string GuardianState, string Kind, object? Validity,
    bool CanPurchaseSeats, string? LogoUrl, string? PrimaryColor);

public sealed record ChildListDto(IReadOnlyList<ChildSummaryDto> Items, IReadOnlyList<GuardianTenantContextDto> Tenants);

/// <summary>Guardian app: the caller's children across their own schools (cross-tenant by design, user-scoped).</summary>
internal static class MeEndpoints
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/v1/me/children", async (ICurrentActor actor, GuardiansDbContext db, ITenantContext tenant, IStudentDirectory students, ITenantDirectory tenants,
            IEntitlements entitlements, ISchoolSettingsReader settings, IClock clock, CancellationToken ct) =>
        {
            var userId = actor.Id!.Value;
            List<Guardian> profiles;
            List<GuardianStudentLink> links;
            using (tenant.CrossTenant("guardian /me/children: the caller's own profiles and links"))
            {
                profiles = await db.Guardians.AsNoTracking()
                    .Where(g => g.UserId == userId && !(g.Kind == GuardianKind.Additional && g.State == GuardianState.PendingActivation))
                    .ToListAsync(ct);
                var ids = profiles.Select(p => p.Id).ToList();
                links = await db.Links.AsNoTracking().Where(l => ids.Contains(l.GuardianId) && l.RemovedAt == null).ToListAsync(ct);
            }

            var now = clock.UtcNow;
            var tenantInfo = await tenants.GetManyAsync(profiles.Select(p => p.TenantId).Distinct().ToList(), ct);
            var children = new List<ChildSummaryDto>();
            var contexts = new List<GuardianTenantContextDto>();
            foreach (var profile in profiles.Where(p => tenantInfo.ContainsKey(p.TenantId)).OrderBy(p => tenantInfo[p.TenantId].Name, StringComparer.OrdinalIgnoreCase))
            {
                var t = tenantInfo[profile.TenantId];
                var ent = await entitlements.ResolveAsync(t.Id, ct);
                bool Has(string key) => ent.Features.Any(f => f.Key == key && f.Enabled);
                var school = await settings.GetAsync(t.Id, ct);
                var (date, _, dow) = TenantTime.Local(t.Timezone, now);
                var w = school.Windows.FirstOrDefault(x => x.IsoDayOfWeek == dow);
                var window = w is null ? null : new PickupEligibilityRules.Window(TenantTime.ToInstant(t.Timezone, date, w.OpensAt), TenantTime.ToInstant(t.Timezone, date, w.ClosesAt));
                var locationRequired = school.LocationRuleEnabled && Has(FeatureKey.DismissalLocationRule);

                contexts.Add(new GuardianTenantContextDto(t.Id, t.Name, t.OperationalMode, profile.Id, profile.State, profile.Kind, null,
                    profile.Kind == GuardianKind.Primary && profile.State == GuardianState.Active && Has(FeatureKey.GuardiansAdditionalPurchase),
                    Has(FeatureKey.BrandingCustom) ? school.LogoUrl : null, Has(FeatureKey.BrandingCustom) ? school.PrimaryColor : null));

                var mine = links.Where(l => l.GuardianId == profile.Id).ToList();
                var refs = await students.GetManyAsync(t.Id, mine.Select(l => l.StudentId).ToList(), ct);
                foreach (var link in mine.Where(l => refs.ContainsKey(l.StudentId)))
                {
                    var s = refs[link.StudentId];
                    var reason = PickupEligibilityRules.Rejection(t.OperationalMode, Has(FeatureKey.DismissalQueue), profile.State, s.Status, s.DismissalEligibility, window, now);
                    children.Add(new ChildSummaryDto(s.Id, t.Id, t.Name, s.FirstName, s.LastName, s.PreferredName, s.ClassName, s.SectionName,
                        link.Relationship, profile.Kind, new PickupEligibilityDto(reason is null, reason, window?.OpensAt, window?.ClosesAt, locationRequired),
                        null)); // active requests arrive with the live queue (Phase 4)
                }
            }

            return new ChildListDto(children, contexts);
        }).RequireGuardian();
    }
}
