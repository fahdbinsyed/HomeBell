using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.BuildingBlocks.Application;

/// <summary>Contract FieldError (VALIDATION_FAILED details).</summary>
public sealed record FieldError(string Field, string Code, string Message);

/// <summary>
/// Thrown by handlers to return a contract Problem. The HTTP status always comes from the error catalog,
/// so a code can never be sent with the wrong status.
/// </summary>
public sealed class ApiProblemException : Exception
{
    public ApiProblemException(
        string code,
        string? detail = null,
        IReadOnlyDictionary<string, object?>? meta = null,
        IReadOnlyList<FieldError>? errors = null)
        : base(detail ?? code)
    {
        if (!ErrorCodes.IsKnown(code))
        {
            throw new ArgumentException($"'{code}' is not a contract ErrorCode.", nameof(code));
        }

        Code = code;
        Detail = detail;
        Meta = meta;
        Errors = errors;
    }

    public ApiProblemException()
        : this(ErrorCodes.InternalError)
    {
    }

    public ApiProblemException(string message, Exception innerException)
        : base(message, innerException)
    {
        Code = ErrorCodes.InternalError;
    }

    public string Code { get; }

    public string? Detail { get; }

    public IReadOnlyDictionary<string, object?>? Meta { get; }

    public IReadOnlyList<FieldError>? Errors { get; }

    public int Status => ErrorCodes.StatusOf(Code);
}

public static class Problem
{
    public static ApiProblemException Of(string code, string? detail = null, IReadOnlyDictionary<string, object?>? meta = null) =>
        new(code, detail, meta);

    public static ApiProblemException NotFound(string? detail = null) => new(ErrorCodes.NotFound, detail);

    public static ApiProblemException Forbidden(string? detail = null) => new(ErrorCodes.Forbidden, detail);

    public static ApiProblemException Unauthenticated(string? detail = null) => new(ErrorCodes.Unauthenticated, detail);
}

/// <summary>Collects field errors; throws one VALIDATION_FAILED problem with all of them.</summary>
public sealed class Validator
{
    private readonly List<FieldError> _errors = [];

    public bool IsValid => _errors.Count == 0;

    public Validator Required(string field, object? value)
    {
        if (value is null || (value is string s && string.IsNullOrWhiteSpace(s)))
        {
            _errors.Add(new FieldError(field, "required", $"{field} is required."));
        }

        return this;
    }

    public Validator MaxLength(string field, string? value, int max)
    {
        if (value is not null && value.Length > max)
        {
            _errors.Add(new FieldError(field, "max_length", $"{field} must be at most {max} characters."));
        }

        return this;
    }

    public Validator MinLength(string field, string? value, int min)
    {
        if (value is not null && value.Length < min)
        {
            _errors.Add(new FieldError(field, "min_length", $"{field} must be at least {min} characters."));
        }

        return this;
    }

    public Validator Pattern(string field, string? value, System.Text.RegularExpressions.Regex pattern, string message)
    {
        if (value is not null && !pattern.IsMatch(value))
        {
            _errors.Add(new FieldError(field, "invalid_format", message));
        }

        return this;
    }

    public Validator OneOf(string field, string? value, IReadOnlyList<string> allowed)
    {
        if (value is not null && !allowed.Contains(value, StringComparer.Ordinal))
        {
            _errors.Add(new FieldError(field, "invalid_value", $"{field} must be one of: {string.Join(", ", allowed)}."));
        }

        return this;
    }

    public Validator Must(bool condition, string field, string code, string message)
    {
        if (!condition)
        {
            _errors.Add(new FieldError(field, code, message));
        }

        return this;
    }

    public void ThrowIfInvalid()
    {
        if (_errors.Count > 0)
        {
            throw new ApiProblemException(ErrorCodes.ValidationFailed, "One or more fields are invalid.", errors: _errors);
        }
    }
}
