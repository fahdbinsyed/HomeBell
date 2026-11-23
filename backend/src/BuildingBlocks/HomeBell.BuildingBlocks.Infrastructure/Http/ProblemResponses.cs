using System.Diagnostics;
using System.Text.Json;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace HomeBell.BuildingBlocks.Infrastructure.Http;

/// <summary>Writes contract <c>Problem</c> bodies (RFC 9457 + code/traceId/meta/errors).</summary>
public static class ProblemWriter
{
    public const string ContentType = "application/problem+json";

    public static async Task WriteAsync(
        HttpContext http,
        string code,
        string? detail = null,
        IReadOnlyDictionary<string, object?>? meta = null,
        IReadOnlyList<FieldError>? errors = null)
    {
        ArgumentNullException.ThrowIfNull(http);
        if (http.Response.HasStarted)
        {
            return;
        }

        var status = ErrorCodes.StatusOf(code);
        var body = new Dictionary<string, object?>
        {
            ["type"] = $"https://docs.homebell.app/errors/{code.ToLowerInvariant().Replace('_', '-')}",
            ["title"] = ErrorCodes.TitleOf(code),
            ["status"] = status,
            ["code"] = code,
            ["traceId"] = Activity.Current?.TraceId.ToString() ?? http.TraceIdentifier,
            ["instance"] = http.Request.Path.Value,
        };
        if (detail is not null)
        {
            body["detail"] = detail;
        }

        if (errors is { Count: > 0 })
        {
            body["errors"] = errors;
        }

        if (meta is { Count: > 0 })
        {
            body["meta"] = meta;
        }

        if (code == ErrorCodes.RateLimited && meta?.TryGetValue("retryAfterSeconds", out var retry) == true)
        {
            http.Response.Headers.RetryAfter = Convert.ToString(retry, System.Globalization.CultureInfo.InvariantCulture);
        }

        http.Response.Clear();
        http.Response.StatusCode = status;
        http.Response.ContentType = ContentType;
        await JsonSerializer.SerializeAsync(http.Response.Body, body, JsonDefaults.Options, http.RequestAborted);
    }
}

/// <summary>
/// Outermost handler: maps <see cref="ApiProblemException"/>, malformed JSON and unexpected exceptions to
/// contract problems, and turns framework status codes (401/403/404/405/415) into contract problems too.
/// </summary>
public sealed partial class ProblemMiddleware(RequestDelegate next, ILogger<ProblemMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext http)
    {
        ArgumentNullException.ThrowIfNull(http);
        try
        {
            await next(http);
            if (!http.Response.HasStarted && http.Response.StatusCode >= 400 && http.Response.ContentLength is null && string.IsNullOrEmpty(http.Response.ContentType))
            {
                var code = http.Response.StatusCode switch
                {
                    401 => http.Items[AuthItems.FailureCode] as string ?? ErrorCodes.Unauthenticated,
                    403 => http.Items[AuthItems.FailureCode] as string ?? ErrorCodes.Forbidden,
                    404 or 405 => ErrorCodes.NotFound,
                    413 => ErrorCodes.PayloadTooLarge,
                    415 => ErrorCodes.UnsupportedMediaType,
                    429 => ErrorCodes.RateLimited,
                    _ => http.Response.StatusCode >= 500 ? ErrorCodes.InternalError : ErrorCodes.BadRequest,
                };
                var meta = code == ErrorCodes.RateLimited ? new Dictionary<string, object?> { ["retryAfterSeconds"] = 60 } : null;
                await ProblemWriter.WriteAsync(http, code, meta: meta);
            }
        }
        catch (ApiProblemException ex)
        {
            await ProblemWriter.WriteAsync(http, ex.Code, ex.Detail, ex.Meta, ex.Errors);
        }
        catch (BadHttpRequestException ex) when (ex.InnerException is JsonException || ex.Message.Contains("JSON", StringComparison.OrdinalIgnoreCase))
        {
            await ProblemWriter.WriteAsync(http, ErrorCodes.ValidationFailed, "Request body is not valid JSON for this operation.",
                errors: [new FieldError("body", "invalid_format", ex.InnerException?.Message ?? ex.Message)]);
        }
        catch (BadHttpRequestException ex)
        {
            await ProblemWriter.WriteAsync(http, ex.StatusCode == 413 ? ErrorCodes.PayloadTooLarge : ErrorCodes.BadRequest, ex.Message);
        }
        catch (JsonException ex)
        {
            await ProblemWriter.WriteAsync(http, ErrorCodes.ValidationFailed, "Request body is not valid JSON for this operation.",
                errors: [new FieldError(ex.Path ?? "body", "invalid_format", ex.Message)]);
        }
        catch (OperationCanceledException) when (http.RequestAborted.IsCancellationRequested)
        {
            // client went away
        }
        catch (Exception ex)
        {
            LogUnhandled(logger, ex, http.Request.Method, http.Request.Path);
            await ProblemWriter.WriteAsync(http, ErrorCodes.InternalError);
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Unhandled exception for {Method} {Path}")]
    private static partial void LogUnhandled(ILogger logger, Exception ex, string method, PathString path);
}

public static class AuthItems
{
    /// <summary>HttpContext.Items key: contract ErrorCode explaining an authentication/authorization failure.</summary>
    public const string FailureCode = "hb.auth.failure";
}

public static class ProblemMiddlewareExtensions
{
    public static IApplicationBuilder UseContractProblems(this IApplicationBuilder app) => app.UseMiddleware<ProblemMiddleware>();
}
