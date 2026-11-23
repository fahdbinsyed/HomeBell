using System.Text.RegularExpressions;

namespace HomeBell.BuildingBlocks.Application;

/// <summary>Log levels of the HomeBell log helper (same set as the neuXplus Common.LogHelper).</summary>
public enum AppLogLevel
{
    Off = 0,
    Debug = 1,
    Info = 2,
    Warning = 3,
    Error = 4,
    Fatal = 5,
}

/// <summary>
/// Application log + audit-trail file logging with a fixed line format:
/// <c>yyyy-MM-dd HH:mm:ss,fff - LEVEL - UniqueId - PlainText - SensitiveData</c>.
/// Sensitive data is always masked (never encrypted, never written in clear); see <see cref="SensitiveData"/>.
/// Inject this where DI is available; use <see cref="LogHelper"/> where it is not.
/// </summary>
public interface IAppLogger
{
    void WriteLine(AppLogLevel level, Guid id, string plainText);

    /// <param name="sensitiveData">Masked before writing (phones, emails, codes, tokens, secrets).</param>
    void WriteLine(AppLogLevel level, Guid id, string plainText, string? sensitiveData);

    void WriteLine(AppLogLevel level, Guid id, string plainText, string? sensitiveData, string? extraDetails);

    void WriteLine(Guid id, string plainText, Exception exception, AppLogLevel level);

    /// <summary>Writes the action to the audit-trail file. The database audit log (audit.audit_log) stays authoritative.</summary>
    void AuditUserAction(Guid id, string message);
}

/// <summary>Where <see cref="LogHelper"/> sends lines; installed once at startup by the host.</summary>
public interface ILogSink
{
    bool IsEnabled(AppLogLevel level);

    void Write(AppLogLevel level, Guid id, string plainText, string maskedSensitive, Exception? exception);

    void Audit(Guid id, string message);
}

/// <summary>
/// Static facade with the familiar <c>LogHelper.WriteLine(...)</c> API for code without DI (startup,
/// static utilities). Lines written before <see cref="Initialize"/> are dropped, as in Common.LogHelper.
/// </summary>
public static class LogHelper
{
    private static ILogSink? _sink;

    public static bool IsInitialized => _sink is not null;

    /// <summary>Call once at application start (the host does this in AddHomeBellLogging).</summary>
    public static void Initialize(ILogSink sink) => _sink = sink ?? throw new ArgumentNullException(nameof(sink));

    public static void WriteLine(AppLogLevel level, Guid id, string plainText) => WriteLine(level, id, plainText, null);

    public static void WriteLine(AppLogLevel level, Guid id, string plainText, string? sensitiveData) =>
        Emit(level, id, plainText, sensitiveData, null);

    public static void WriteLine(AppLogLevel level, Guid id, string plainText, string? sensitiveData, string? extraDetails) =>
        Emit(level, id, extraDetails is null ? plainText : plainText + Environment.NewLine + extraDetails, sensitiveData, null);

    public static void WriteLine(Guid id, string plainText, Exception exception, AppLogLevel level) =>
        Emit(level, id, plainText, null, exception);

    public static void AuditUserAction(Guid id, string message)
    {
        try
        {
            _sink?.Audit(id, SensitiveData.Scrub(message ?? string.Empty));
        }
#pragma warning disable CA1031 // logging must never break the caller
        catch
        {
        }
#pragma warning restore CA1031
    }

    internal static void Emit(AppLogLevel level, Guid id, string plainText, string? sensitiveData, Exception? exception)
    {
        var sink = _sink;
        if (sink is null || level == AppLogLevel.Off || !sink.IsEnabled(level))
        {
            return;
        }

        try
        {
            sink.Write(level, id, SensitiveData.Scrub(plainText ?? string.Empty), SensitiveData.Mask(sensitiveData), exception);
        }
#pragma warning disable CA1031 // logging must never break the caller
        catch
        {
        }
#pragma warning restore CA1031
    }
}

/// <summary>DI-friendly <see cref="IAppLogger"/> over the same sink as <see cref="LogHelper"/>.</summary>
public sealed class AppLogger : IAppLogger
{
    public void WriteLine(AppLogLevel level, Guid id, string plainText) => LogHelper.WriteLine(level, id, plainText);

    public void WriteLine(AppLogLevel level, Guid id, string plainText, string? sensitiveData) =>
        LogHelper.WriteLine(level, id, plainText, sensitiveData);

    public void WriteLine(AppLogLevel level, Guid id, string plainText, string? sensitiveData, string? extraDetails) =>
        LogHelper.WriteLine(level, id, plainText, sensitiveData, extraDetails);

    public void WriteLine(Guid id, string plainText, Exception exception, AppLogLevel level) =>
        LogHelper.WriteLine(id, plainText, exception, level);

    public void AuditUserAction(Guid id, string message) => LogHelper.AuditUserAction(id, message);
}

/// <summary>
/// Masking rules for logs (docs/architecture/08-security-privacy.md §5): no OTP codes, tokens, passwords or
/// full phone numbers/emails in log files. <see cref="Mask"/> is for the sensitive-data field;
/// <see cref="Scrub"/> is applied to every plain-text message as a safety net.
/// </summary>
public static partial class SensitiveData
{
    public const string Redacted = "[REDACTED]";

    public static string Mask(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var masked = Scrub(value);
        // Anything left that is not obviously safe is reduced to a length hint.
        return masked.Length > 0 && masked == value && !value.Contains('•', StringComparison.Ordinal)
            ? $"[MASKED:{value.Length} chars]"
            : masked;
    }

    public static string Scrub(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var s = Jwt().Replace(text, Redacted);
        s = SecretPair().Replace(s, m => $"{m.Groups[1].Value}{m.Groups[2].Value}{Redacted}");
        s = Bearer().Replace(s, "Bearer " + Redacted);
        s = Email().Replace(s, m => $"{m.Groups[1].Value[0]}•••@{m.Groups[2].Value}");
        s = PhoneE164().Replace(s, m => Phone.Mask(m.Value));
        s = SixDigits().Replace(s, "••••••");
        s = LongToken().Replace(s, m => m.Value[..4] + "…" + Redacted);
        return s;
    }

    [GeneratedRegex(@"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*")]
    private static partial Regex Jwt();

    [GeneratedRegex(@"(?i)\b(password|pwd|secret|token|refreshtoken|accesstoken|otp|code|pin|apikey|api_key)(\s*[=:]\s*""?)[^\s"",;&]+")]
    private static partial Regex SecretPair();

    [GeneratedRegex(@"(?i)Bearer\s+[A-Za-z0-9._~+/=-]+")]
    private static partial Regex Bearer();

    [GeneratedRegex(@"\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b")]
    private static partial Regex Email();

    [GeneratedRegex(@"\+[1-9]\d{6,14}\b")]
    private static partial Regex PhoneE164();

    [GeneratedRegex(@"(?<![\d-])\d{6}(?![\d-])")]
    private static partial Regex SixDigits();

    // Long opaque tokens/keys; GUIDs (record ids) are deliberately left readable.
    [GeneratedRegex(@"\b(?![0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b)[A-Za-z0-9_-]{32,}\b")]
    private static partial Regex LongToken();
}
