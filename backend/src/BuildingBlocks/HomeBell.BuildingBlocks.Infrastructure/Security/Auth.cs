using System.Security.Claims;
using System.Security.Cryptography;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.BuildingBlocks.Infrastructure.Http;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

namespace HomeBell.BuildingBlocks.Infrastructure.Security;

public sealed class AuthOptions
{
    public string Issuer { get; set; } = "https://api.homebell.app";

    public string Audience { get; set; } = "homebell-api";

    public int AccessTokenMinutes { get; set; } = 10;

    /// <summary>PKCS#8 PEM of the ES256 (P-256) signing key. Required outside Development/Testing.</summary>
    public string? SigningKeyPem { get; set; }

    public string KeyId { get; set; } = "hb-1";
}

public static class HomeBellClaims
{
    public const string Subject = "sub";
    public const string Session = "sid";
    public const string Kind = "kind";
    public const string Scope = "scp";
    public const string Device = "did";
    public const string PlatformRole = "prm";
    public const string SupportTenant = "sup";
    public const string Name = "name";
}

/// <summary>ES256 signing key; ephemeral in Development/Testing when none is configured.</summary>
public sealed class SigningKeys : IDisposable
{
    private readonly ECDsa _ecdsa;

    public SigningKeys(AuthOptions options, IHostEnvironment env)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(env);
        _ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        if (!string.IsNullOrWhiteSpace(options.SigningKeyPem))
        {
            _ecdsa.ImportFromPem(options.SigningKeyPem);
        }
        else if (!(env.IsDevelopment() || env.IsEnvironment("Testing")))
        {
            throw new InvalidOperationException("Auth:SigningKeyPem must be configured outside Development.");
        }

        Key = new ECDsaSecurityKey(_ecdsa) { KeyId = options.KeyId };
        Credentials = new SigningCredentials(Key, SecurityAlgorithms.EcdsaSha256);
    }

    public ECDsaSecurityKey Key { get; }

    public SigningCredentials Credentials { get; }

    public void Dispose() => _ecdsa.Dispose();
}

public sealed class AccessTokenIssuer(AuthOptions options, SigningKeys keys, IClock clock) : IAccessTokenIssuer
{
    private readonly JsonWebTokenHandler _handler = new();

    public (string Token, DateTimeOffset ExpiresAt) Issue(AccessTokenClaims c)
    {
        ArgumentNullException.ThrowIfNull(c);
        var now = clock.UtcNow;
        var expires = now.AddMinutes(options.AccessTokenMinutes);
        var claims = new Dictionary<string, object>
        {
            [HomeBellClaims.Subject] = c.UserId.ToString(),
            [HomeBellClaims.Session] = c.SessionId.ToString(),
            [HomeBellClaims.Kind] = c.Kind,
            [HomeBellClaims.Scope] = c.Scope,
            [HomeBellClaims.Name] = c.DisplayName,
            ["jti"] = Guid.CreateVersion7().ToString(),
        };
        if (c.DeviceId is { } did)
        {
            claims[HomeBellClaims.Device] = did.ToString();
        }

        if (c.PlatformRoles is { Count: > 0 } roles)
        {
            claims[HomeBellClaims.PlatformRole] = roles.ToArray();
        }

        if (c.SupportTenantId is { } sup)
        {
            claims[HomeBellClaims.SupportTenant] = sup.ToString();
        }

        var token = _handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = options.Issuer,
            Audience = options.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expires.UtcDateTime,
            Claims = claims,
            SigningCredentials = keys.Credentials,
        });
        return (token, expires);
    }
}

public sealed class RedisSessionRevocationList(IConnectionMultiplexer redis, AuthOptions options) : ISessionRevocationList
{
    private static RedisKey Key(Guid sid) => $"hb:revoked-sid:{sid}";

    public Task RevokeAsync(Guid sessionId, CancellationToken cancellationToken) =>
        redis.GetDatabase().StringSetAsync(Key(sessionId), "1", TimeSpan.FromMinutes(options.AccessTokenMinutes + 1));

    public Task<bool> IsRevokedAsync(Guid sessionId, CancellationToken cancellationToken) =>
        redis.GetDatabase().KeyExistsAsync(Key(sessionId));
}

/// <summary>Request-scoped view of the authenticated caller.</summary>
public sealed class CurrentActor(IHttpContextAccessor accessor) : ICurrentActor
{
    private ClaimsPrincipal? User => accessor.HttpContext?.User;

    private string? Claim(string type) => User?.FindFirst(type)?.Value;

    public bool IsAuthenticated => User?.Identity?.IsAuthenticated == true && Claim(HomeBellClaims.Subject) is not null;

    public ActorType Type => SessionKind switch
    {
        Domain.Contract.SessionKind.Display => ActorType.Display,
        Domain.Contract.SessionKind.Support => ActorType.Support,
        _ => ActorType.User,
    };

    public Guid? Id => Guid.TryParse(Claim(HomeBellClaims.Subject), out var g) ? g : null;

    public string DisplayName => Claim(HomeBellClaims.Name) ?? "Unknown";

    public Guid? SessionId => Guid.TryParse(Claim(HomeBellClaims.Session), out var g) ? g : null;

    public Guid? DeviceId => Guid.TryParse(Claim(HomeBellClaims.Device), out var g) ? g : null;

    public string? SessionKind => Claim(HomeBellClaims.Kind);

    public string? Scope => Claim(HomeBellClaims.Scope);

    public Guid? SupportTenantId => Guid.TryParse(Claim(HomeBellClaims.SupportTenant), out var g) ? g : null;

    public IReadOnlyCollection<string> PlatformRoles =>
        User?.FindAll(HomeBellClaims.PlatformRole).Select(c => c.Value).ToList() ?? [];

    public string? IpAddress => accessor.HttpContext?.Connection.RemoteIpAddress?.ToString();

    public string? UserAgent => accessor.HttpContext?.Request.Headers.UserAgent.ToString();

    public string RequestId => accessor.HttpContext?.TraceIdentifier ?? "background";
}

public static class AuthServiceCollectionExtensions
{
    public static IServiceCollection AddHomeBellAuth(this IServiceCollection services, IConfiguration configuration, string redisConnectionString)
    {
        var options = configuration.GetSection("Auth").Get<AuthOptions>() ?? new AuthOptions();
        services.AddSingleton(options);
        services.AddSingleton<SigningKeys>();
        services.AddSingleton<IAccessTokenIssuer, AccessTokenIssuer>();
        services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConnectionString));
        services.AddSingleton<ISessionRevocationList, RedisSessionRevocationList>();
        services.AddHttpContextAccessor();
        services.AddScoped<CurrentActor>();
        services.AddScoped<ICurrentActor>(sp => sp.GetRequiredService<CurrentActor>());

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, _ => { });
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<SigningKeys>((jwt, keys) =>
            {
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = options.Issuer,
                    ValidAudience = options.Audience,
                    IssuerSigningKey = keys.Key,
                    ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = HomeBellClaims.Name,
                };
                jwt.Events = new JwtBearerEvents
                {
                    OnTokenValidated = async ctx =>
                    {
                        var sid = ctx.Principal?.FindFirst(HomeBellClaims.Session)?.Value;
                        var revocations = ctx.HttpContext.RequestServices.GetRequiredService<ISessionRevocationList>();
                        if (!Guid.TryParse(sid, out var sessionId) || await revocations.IsRevokedAsync(sessionId, ctx.HttpContext.RequestAborted))
                        {
                            ctx.HttpContext.Items[AuthItems.FailureCode] = ErrorCodes.SessionRevoked;
                            ctx.Fail("session revoked");
                        }
                    },
                    OnAuthenticationFailed = ctx =>
                    {
                        if (ctx.Exception is SecurityTokenExpiredException)
                        {
                            ctx.HttpContext.Items[AuthItems.FailureCode] = ErrorCodes.TokenExpired;
                        }

                        return Task.CompletedTask;
                    },
                    OnChallenge = async ctx =>
                    {
                        ctx.HandleResponse();
                        var code = ctx.HttpContext.Items[AuthItems.FailureCode] as string ?? ErrorCodes.Unauthenticated;
                        await ProblemWriter.WriteAsync(ctx.HttpContext, code);
                    },
                };
            });
        services.AddAuthorization();
        return services;
    }
}
