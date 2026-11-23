using System.Security.Cryptography;
using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;

namespace HomeBell.BuildingBlocks.Infrastructure.Http;

/// <summary>Endpoint metadata: this operation requires an <c>Idempotency-Key</c> (07-audit-outbox-workers §3).</summary>
public sealed record IdempotentOperation(string Scope);

public static class IdempotencyExtensions
{
    public static TBuilder RequireIdempotency<TBuilder>(this TBuilder builder, string scope)
        where TBuilder : IEndpointConventionBuilder
    {
        builder.WithMetadata(new IdempotentOperation(scope));
        return builder;
    }

    public static IApplicationBuilder UseIdempotency(this IApplicationBuilder app) => app.UseMiddleware<IdempotencyMiddleware>();
}

/// <summary>
/// Same key + same body → the stored response is replayed with <c>Idempotent-Replayed: true</c>; same key +
/// different body → 422 IDEMPOTENCY_KEY_REUSED; same key still running → 409 IDEMPOTENCY_IN_PROGRESS.
/// Records live 24 h in Redis (AOF-persisted), keyed per caller so keys never collide across users.
/// Server errors (5xx) are not stored, so the client can retry with the same key.
/// </summary>
public sealed class IdempotencyMiddleware(RequestDelegate next)
{
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(24);
    private static readonly TimeSpan InFlightTtl = TimeSpan.FromMinutes(2);

    public async Task InvokeAsync(HttpContext http)
    {
        ArgumentNullException.ThrowIfNull(http);
        var op = http.GetEndpoint()?.Metadata.GetMetadata<IdempotentOperation>();
        if (op is null)
        {
            await next(http);
            return;
        }

        var key = http.Request.Headers["Idempotency-Key"].ToString();
        if (string.IsNullOrWhiteSpace(key))
        {
            throw Problem.Of(ErrorCodes.IdempotencyKeyRequired);
        }

        if (key.Length is < 8 or > 128)
        {
            throw new ApiProblemException(ErrorCodes.ValidationFailed, "Idempotency-Key must be 8–128 characters.",
                errors: [new FieldError("Idempotency-Key", "invalid_format", "Must be 8–128 characters.")]);
        }

        http.Request.EnableBuffering();
        using var ms = new MemoryStream();
        await http.Request.Body.CopyToAsync(ms, http.RequestAborted);
        http.Request.Body.Position = 0;
        var hash = Convert.ToHexStringLower(SHA256.HashData([.. System.Text.Encoding.UTF8.GetBytes($"{http.Request.Method} {http.Request.Path}\n"), .. ms.ToArray()]));

        var actor = http.RequestServices.GetRequiredService<ICurrentActor>();
        var redis = http.RequestServices.GetRequiredService<IConnectionMultiplexer>().GetDatabase();
        RedisKey redisKey = $"hb:idem:{op.Scope}:{actor.Id?.ToString() ?? "anon"}:{key}";

        var started = new Stored(hash, false, 0, null, null);
        if (!await redis.StringSetAsync(redisKey, JsonSerializer.Serialize(started), InFlightTtl, When.NotExists))
        {
            var existing = await redis.StringGetAsync(redisKey);
            var stored = existing.HasValue ? JsonSerializer.Deserialize<Stored>(existing.ToString()) : null;
            if (stored is null)
            {
                throw Problem.Of(ErrorCodes.IdempotencyInProgress, meta: new Dictionary<string, object?> { ["retryAfterSeconds"] = 2 });
            }

            if (stored.Hash != hash)
            {
                throw Problem.Of(ErrorCodes.IdempotencyKeyReused);
            }

            if (!stored.Completed)
            {
                http.Response.Headers.RetryAfter = "2";
                throw Problem.Of(ErrorCodes.IdempotencyInProgress, meta: new Dictionary<string, object?> { ["retryAfterSeconds"] = 2 });
            }

            http.Response.StatusCode = stored.Status;
            http.Response.Headers["Idempotent-Replayed"] = "true";
            if (stored.ContentType is not null)
            {
                http.Response.ContentType = stored.ContentType;
            }

            if (stored.Body is not null)
            {
                await http.Response.WriteAsync(stored.Body, http.RequestAborted);
            }

            return;
        }

        var original = http.Response.Body;
        await using var buffer = new MemoryStream();
        http.Response.Body = buffer;
        try
        {
            await next(http);
        }
        catch
        {
            await redis.KeyDeleteAsync(redisKey); // let the client retry the same key
            http.Response.Body = original;
            throw;
        }

        http.Response.Body = original;
        buffer.Position = 0;
        var body = await new StreamReader(buffer).ReadToEndAsync(http.RequestAborted);
        if (http.Response.StatusCode >= 500)
        {
            await redis.KeyDeleteAsync(redisKey);
        }
        else
        {
            await redis.StringSetAsync(redisKey, JsonSerializer.Serialize(new Stored(hash, true, http.Response.StatusCode, http.Response.ContentType, body)), Ttl);
        }

        buffer.Position = 0;
        await buffer.CopyToAsync(original, http.RequestAborted);
    }

    private sealed record Stored(string Hash, bool Completed, int Status, string? ContentType, string? Body);
}
