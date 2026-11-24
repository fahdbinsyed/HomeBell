using System.Net.Mail;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure;
using HomeBell.BuildingBlocks.Infrastructure.Persistence;
using HomeBell.BuildingBlocks.Infrastructure.Security;
using HomeBell.Modules.Identity.Application;
using HomeBell.Modules.Identity.Contracts;
using HomeBell.Modules.Identity.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace HomeBell.Modules.Identity.Infrastructure;

public sealed class SmtpOptions
{
    /// <summary>Local Mailpit by default (infra/docker-compose.yml; inbox at http://localhost:8025).</summary>
    public string Host { get; set; } = "localhost";

    public int Port { get; set; } = 1025;

    public string From { get; set; } = "HomeBell <no-reply@homebell.test>";

    /// <summary>"smtp" (dev: Mailpit) or "none" (OTP sends fail with OTP_TEMPORARILY_UNAVAILABLE until an SMS provider is chosen).</summary>
    public string OtpDelivery { get; set; } = "smtp";
}

/// <summary>Composition entry point of the Identity module.</summary>
public sealed class IdentityModule : IModule
{
    public string Name => "Identity";

    public string Schema => IdentityDbContext.SchemaName;

    public void Register(IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddModuleDbContext<IdentityDbContext>(Schema, (o, d) => new IdentityDbContext(o, d));
        var otp = configuration.GetSection("Otp").Get<OtpOptions>() ?? new OtpOptions();
        var smtp = configuration.GetSection("Smtp").Get<SmtpOptions>() ?? new SmtpOptions();
        services.AddSingleton(otp);
        services.AddSingleton(smtp);
        services.AddSingleton(configuration.GetSection("Terms").Get<TermsOptions>() ?? new TermsOptions());
        services.AddSingleton(configuration.GetSection("StaffAuth").Get<StaffAuthOptions>() ?? new StaffAuthOptions());
        services.AddSingleton<IdentityCrypto>();
        services.AddSingleton<IPasswordHasher<UserAccount>, PasswordHasher<UserAccount>>();
        services.AddDataProtection().SetApplicationName("HomeBell");
        services.AddScoped<SessionService>();
        services.AddScoped<MeBuilder>();
        services.AddScoped<StaffAuthService>();
        services.AddScoped<StaffInvitationAuth>();
        services.AddScoped<IUserDirectory, UserDirectory>();
        var fixedCode = configuration["Otp:DevelopmentFixedCode"];
        services.AddScoped(sp =>
        {
            var svc = ActivatorUtilities.CreateInstance<GuardianOtpService>(sp);
            svc.FixedCodeForDevelopment = string.IsNullOrWhiteSpace(fixedCode) ? null : fixedCode;
            return svc;
        });
        services.AddScoped<IUserAccounts, UserAccounts>();
        services.AddScoped<IdentitySessionIssuer>();
        services.AddScoped<ISessionIssuer>(sp => sp.GetRequiredService<IdentitySessionIssuer>());
        services.AddScoped<IOtpUsage>(sp => sp.GetRequiredService<IdentitySessionIssuer>());
        services.AddSingleton<IEmailSender, SmtpEmailSender>();
        if (smtp.OtpDelivery == "smtp")
        {
            services.AddSingleton<IOtpSender, MailpitOtpSender>();
        }
        else
        {
            services.AddSingleton<IOtpSender, UnavailableOtpSender>();
        }
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        PlatformUserEndpoints.Map(endpoints);

        var auth = endpoints.MapGroup("/v1/auth").RequireRateLimiting("auth");

        auth.MapPost("/staff/login", (StaffLoginRequest body, StaffAuthService svc, CancellationToken ct) => svc.LoginAsync(body, ct));
        auth.MapPost("/staff/mfa/verify", (MfaVerifyRequest body, StaffAuthService svc, CancellationToken ct) => svc.VerifyMfaAsync(body, ct));
        auth.MapPost("/staff/mfa/enroll", (MfaEnrollStartRequest body, StaffAuthService svc, CancellationToken ct) => svc.StartEnrollmentAsync(body, ct));
        auth.MapPost("/staff/mfa/enroll/confirm", (MfaEnrollConfirmRequest body, StaffAuthService svc, CancellationToken ct) => svc.ConfirmEnrollmentAsync(body, ct));
        auth.MapPost("/staff/invitations/preview", (InvitationTokenRequest body, StaffInvitationAuth svc, CancellationToken ct) => svc.PreviewAsync(body, ct));
        auth.MapPost("/staff/invitations/accept", (StaffInvitationAcceptRequest body, StaffInvitationAuth svc, CancellationToken ct) => svc.AcceptAsync(body, ct));
        auth.MapPost("/staff/password/forgot", async (PasswordForgotRequest body, StaffAuthService svc, CancellationToken ct) =>
        {
            await svc.ForgotPasswordAsync(body, ct);
            return Results.NoContent();
        });
        auth.MapPost("/staff/password/reset", async (PasswordResetRequest body, StaffAuthService svc, CancellationToken ct) =>
        {
            await svc.ResetPasswordAsync(body, ct);
            return Results.NoContent();
        });

        auth.MapPost("/otp/send", async (OtpSendRequest body, HttpRequest http, GuardianOtpService svc, CancellationToken ct) =>
            Results.Json(await svc.SendAsync(body, OptionalDeviceId(http), ct), JsonDefaults.Options, statusCode: StatusCodes.Status202Accepted));
        auth.MapPost("/otp/resend", async (OtpResendRequest body, HttpRequest http, GuardianOtpService svc, CancellationToken ct) =>
            Results.Json(await svc.ResendAsync(body, OptionalDeviceId(http), ct), JsonDefaults.Options, statusCode: StatusCodes.Status202Accepted));
        auth.MapPost("/otp/verify", (OtpVerifyRequest body, HttpRequest http, GuardianOtpService svc, CancellationToken ct) =>
            svc.VerifyAsync(body, RequiredDeviceId(http), ct));

        auth.MapPost("/refresh", async (RefreshRequest body, HttpRequest http, SessionService sessions, CancellationToken ct) =>
        {
            new Validator().Required("refreshToken", body.RefreshToken).ThrowIfInvalid();
            var (_, tokens) = await sessions.RefreshAsync(body.RefreshToken!, OptionalDeviceId(http), ct);
            return tokens;
        });

        auth.MapPost("/logout", async (ICurrentActor actor, IdentityDbContext db, SessionService sessions, CancellationToken ct) =>
        {
            var session = await db.Sessions.FirstOrDefaultAsync(s => s.Id == actor.SessionId, ct);
            if (session is not null)
            {
                await sessions.RevokeAsync(session, SessionRevokeReason.Logout, ct);
            }

            return Results.NoContent();
        }).RequireSession(SessionKind.All.ToArray(), SessionScope.All.ToArray());

        auth.MapGet("/me", async (ICurrentActor actor, IdentityDbContext db, MeBuilder me, CancellationToken ct) =>
        {
            var session = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == actor.SessionId, ct) ?? throw Problem.Of(ErrorCodes.SessionRevoked);
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == session.UserId, ct);
            return await me.BuildAsync(user, session, ct);
        }).RequireSession(SessionKind.All.ToArray(), SessionScope.All.ToArray());
    }

    /// <summary>X-Device-Id (app install id). Required for OTP verify (DEVICE_ID_REQUIRED).</summary>
    internal static Guid RequiredDeviceId(HttpRequest http) =>
        OptionalDeviceId(http) ?? throw Problem.Of(ErrorCodes.DeviceIdRequired);

    internal static Guid? OptionalDeviceId(HttpRequest http) =>
        Guid.TryParse(http.Headers["X-Device-Id"].ToString(), out var id) ? id : null;
}

internal sealed class UserAccounts(IdentityDbContext db, IClock clock) : IUserAccounts
{
    public async Task<Guid> EnsureByPhoneAsync(string phoneE164, string fullName, CancellationToken cancellationToken)
    {
        var existing = await db.Users.FirstOrDefaultAsync(u => u.Phone == phoneE164, cancellationToken);
        if (existing is not null)
        {
            return existing.Id;
        }

        var user = new UserAccount(Guid.CreateVersion7(), fullName, null, phoneE164, clock.UtcNow);
        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        return user.Id;
    }

    public async Task<Guid> EnsureByEmailAsync(string email, string fullName, CancellationToken cancellationToken)
    {
        var key = email.Trim().ToLowerInvariant();
        var existing = await db.Users.FirstOrDefaultAsync(u => u.Email == key, cancellationToken);
        if (existing is not null)
        {
            return existing.Id;
        }

        var user = new UserAccount(Guid.CreateVersion7(), fullName, key, null, clock.UtcNow);
        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        return user.Id;
    }
}

/// <summary>Plain SMTP (Mailpit locally; a real relay in deployed environments).</summary>
internal sealed class SmtpEmailSender(SmtpOptions options) : IEmailSender
{
    public async Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
    {
        using var client = new SmtpClient(options.Host, options.Port) { EnableSsl = false };
        using var message = new MailMessage(new MailAddress(ParseAddress(options.From), ParseName(options.From)), new MailAddress(to))
        {
            Subject = subject,
            Body = textBody,
        };
        await client.SendMailAsync(message, cancellationToken);
    }

    private static string ParseAddress(string from) => from.Contains('<', StringComparison.Ordinal) ? from[(from.IndexOf('<', StringComparison.Ordinal) + 1)..].TrimEnd('>') : from;

    private static string ParseName(string from) => from.Contains('<', StringComparison.Ordinal) ? from[..from.IndexOf('<', StringComparison.Ordinal)].Trim() : "HomeBell";
}

/// <summary>Development stand-in for SMS: the "text message" lands in the Mailpit inbox (never in logs).</summary>
internal sealed class MailpitOtpSender(IEmailSender email) : IOtpSender
{
    public Task SendAsync(string phoneE164, string code, string purpose, CancellationToken cancellationToken) =>
        email.SendAsync($"sms+{phoneE164.TrimStart('+')}@sms.homebell.test", $"SMS to {phoneE164}",
            purpose == "welcome"
                ? $"{code} registered this number for school pickup on HomeBell. Install the HomeBell app and sign in with this phone number."
                : $"HomeBell code: {code}. It expires in 5 minutes. Never share this code.", cancellationToken);
}

/// <summary>Until an SMS provider is chosen (Phase 3 decision), production OTP sends fail closed.</summary>
internal sealed class UnavailableOtpSender : IOtpSender
{
    public Task SendAsync(string phoneE164, string code, string purpose, CancellationToken cancellationToken) =>
        throw Problem.Of(ErrorCodes.OtpTemporarilyUnavailable);
}
