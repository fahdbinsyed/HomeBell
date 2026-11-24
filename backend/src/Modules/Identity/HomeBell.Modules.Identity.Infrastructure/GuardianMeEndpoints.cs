using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Identity.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace HomeBell.Modules.Identity.Infrastructure;

public sealed record GuardianProfileUpdate(string? FullName, string? Locale);

public sealed record TermsAcceptanceRequest(string? TermsVersion);

public sealed record DeviceStatusDto(DeviceSummaryDto CurrentDevice, bool IsActiveDevice, DateTimeOffset? LastTransferAt, DateTimeOffset? NextTransferAllowedAt, IReadOnlyList<object> TransferHistory);

/// <summary>Guardian app identity endpoints under /v1/me (profile, terms, device).</summary>
internal static class GuardianMeEndpoints
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var me = endpoints.MapGroup("/v1/me");

        me.MapGet("/profile", async (ICurrentActor actor, IdentityDbContext db, MeBuilder builder, CancellationToken ct) =>
        {
            var (user, session) = await LoadAsync(actor, db, ct);
            return await builder.BuildAsync(user, session, ct);
        }).RequireGuardian();

        me.MapPatch("/profile", async (GuardianProfileUpdate b, ICurrentActor actor, IdentityDbContext db, MeBuilder builder, CancellationToken ct) =>
        {
            new Validator()
                .Must(b.FullName is not null || b.Locale is not null, "body", "min_properties", "Nothing to update.")
                .Must(b.FullName is null || b.FullName.Trim().Length > 0, "fullName", "required", "Name cannot be empty.")
                .MaxLength("fullName", b.FullName, 120)
                .MaxLength("locale", b.Locale, 10)
                .ThrowIfInvalid();
            var (user, session) = await LoadAsync(actor, db, ct, track: true);
            if (b.FullName is { } name)
            {
                user.Rename(name.Trim());
            }

            if (b.Locale is { Length: > 0 } locale)
            {
                user.Locale = locale;
            }

            await db.SaveChangesAsync(ct);
            return await builder.BuildAsync(user, session, ct);
        }).RequireGuardian();

        // Allowed in a limited purchase session too: accepting the terms is part of onboarding.
        me.MapPost("/terms-acceptance", async (TermsAcceptanceRequest b, ICurrentActor actor, IdentityDbContext db, TermsOptions terms, IAuditWriter audit, IClock clock, CancellationToken ct) =>
        {
            new Validator().Required("termsVersion", b.TermsVersion)
                .Must(b.TermsVersion is null || b.TermsVersion == terms.CurrentVersion, "termsVersion", "invalid_value", "Please review the latest terms.")
                .ThrowIfInvalid();
            var (user, _) = await LoadAsync(actor, db, ct, track: true);
            user.AcceptTerms(b.TermsVersion!, clock.UtcNow);
            audit.Write(new AuditEntry(AuditAction.AuthLogin, AuditOutcome.Success, "user", user.Id.ToString(), "terms_accepted",
                new Dictionary<string, object?> { ["termsVersion"] = b.TermsVersion }, ActorIdOverride: user.Id, ActorDisplayOverride: user.FullName));
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireGuardian([SessionScope.Full, SessionScope.GuardianLicensePurchase]);

        me.MapGet("/device", async (ICurrentActor actor, IdentityDbContext db, CancellationToken ct) =>
        {
            var userId = actor.Id!.Value;
            var install = actor.DeviceId!.Value;
            var device = await db.Devices.AsNoTracking().Where(d => d.UserId == userId && d.InstallId == install)
                .OrderByDescending(d => d.ActivatedAt).FirstOrDefaultAsync(ct) ?? throw Problem.Of(ErrorCodes.DeviceRevoked);
            // Transfer history and the 30-day cooldown arrive with Phase 6.
            return new DeviceStatusDto(
                new DeviceSummaryDto(device.Id, device.Platform, device.Model, device.State, device.ActivatedAt, device.LastSeenAt),
                device.State == DeviceState.Active, null, null, []);
        }).RequireGuardian([SessionScope.Full, SessionScope.GuardianLicensePurchase]);
    }

    private static async Task<(UserAccount User, Session Session)> LoadAsync(ICurrentActor actor, IdentityDbContext db, CancellationToken ct, bool track = false)
    {
        var session = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == actor.SessionId, ct) ?? throw Problem.Of(ErrorCodes.SessionRevoked);
        var users = track ? db.Users : db.Users.AsNoTracking();
        return (await users.FirstAsync(u => u.Id == session.UserId, ct), session);
    }
}
