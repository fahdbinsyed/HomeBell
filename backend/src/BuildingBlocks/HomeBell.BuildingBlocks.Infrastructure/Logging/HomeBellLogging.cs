using HomeBell.BuildingBlocks.Application;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;
using Serilog.Core;
using Serilog.Events;

namespace HomeBell.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// File logging settings (section <c>FileLogging</c>). Mirrors the neuXplus log4net setup: a rolling
/// application log (10 × 10 MB) and a separate audit-trail log; errors also go to the console.
/// </summary>
public sealed class FileLoggingOptions
{
    /// <summary>Directory for log files (relative to the content root).</summary>
    public string Directory { get; set; } = "Logs";

    /// <summary>File name stem; "%ApplicationName" is replaced by the host's application name.</summary>
    public string FileName { get; set; } = "%ApplicationName";

    public AppLogLevel MinimumLevel { get; set; } = AppLogLevel.Debug;

    public long MaximumFileSizeBytes { get; set; } = 10_000_000;

    public int MaxSizeRollBackups { get; set; } = 10;

    /// <summary>Framework (ASP.NET Core / EF Core) messages below this level are not written.</summary>
    public LogEventLevel FrameworkMinimumLevel { get; set; } = LogEventLevel.Warning;
}

public static class HomeBellLogging
{
    internal const string Channel = "HbChannel";
    internal const string UniqueId = "UniqueId";
    internal const string PlainText = "PlainText";
    internal const string Sensitive = "Sensitive";
    internal const string LevelName = "LevelName";

    /// <summary>
    /// Line format: <c>2026-11-23 14:31:07,123 - INFO - {UniqueId} - {PlainText} - {SensitiveData}</c>.
    /// Framework log events use the request/trace id as UniqueId and their rendered message as PlainText.
    /// </summary>
    private const string LineTemplate =
        "{Timestamp:yyyy-MM-dd HH:mm:ss,fff} - {LevelName} - {UniqueId} - {PlainText} - {Sensitive}{NewLine}{Exception}";

    /// <summary>
    /// Routes all ILogger output through Serilog into the application log, adds the audit-trail log, and
    /// initialises <see cref="LogHelper"/> / <see cref="IAppLogger"/>.
    /// </summary>
    public static IServiceCollection AddHomeBellLogging(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);
        var options = configuration.GetSection("FileLogging").Get<FileLoggingOptions>() ?? new FileLoggingOptions();
        var dir = Path.IsPathRooted(options.Directory) ? options.Directory : Path.Combine(environment.ContentRootPath, options.Directory);
        var stem = options.FileName.Replace("%ApplicationName", environment.ApplicationName, StringComparison.Ordinal);

        var logger = new LoggerConfiguration()
            .MinimumLevel.Is(ToSerilog(options.MinimumLevel))
            .MinimumLevel.Override("Microsoft", options.FrameworkMinimumLevel)
            .MinimumLevel.Override("System", options.FrameworkMinimumLevel)
            .Enrich.FromLogContext()
            .Enrich.With<LineFieldsEnricher>()
            .WriteTo.Logger(app => app
                .Filter.ByExcluding(e => IsChannel(e, "audit"))
                .WriteTo.File(
                    Path.Combine(dir, stem + ".log"),
                    outputTemplate: LineTemplate,
                    fileSizeLimitBytes: options.MaximumFileSizeBytes,
                    rollOnFileSizeLimit: true,
                    retainedFileCountLimit: options.MaxSizeRollBackups + 1,
                    shared: true,
                    encoding: System.Text.Encoding.UTF8))
            .WriteTo.Logger(audit => audit
                .Filter.ByIncludingOnly(e => IsChannel(e, "audit"))
                .WriteTo.File(
                    Path.Combine(dir, stem + ".audit.log"),
                    outputTemplate: LineTemplate,
                    fileSizeLimitBytes: options.MaximumFileSizeBytes,
                    rollOnFileSizeLimit: true,
                    retainedFileCountLimit: options.MaxSizeRollBackups + 1,
                    shared: true,
                    encoding: System.Text.Encoding.UTF8))
            // Error/Fatal also go to the console (container / service logs), like the Event Log appender.
            .WriteTo.Logger(console => console
                .Filter.ByExcluding(e => IsChannel(e, "audit"))
                .WriteTo.Console(LogEventLevel.Error, outputTemplate: LineTemplate, formatProvider: System.Globalization.CultureInfo.InvariantCulture))
            .CreateLogger();

        Log.Logger = logger;
        LogHelper.Initialize(new SerilogLogSink(logger));
        services.AddSerilog(logger, dispose: true);
        services.AddSingleton<IAppLogger, AppLogger>();
        services.AddSingleton(options);
        return services;
    }

    internal static LogEventLevel ToSerilog(AppLogLevel level) => level switch
    {
        AppLogLevel.Debug => LogEventLevel.Debug,
        AppLogLevel.Info => LogEventLevel.Information,
        AppLogLevel.Warning => LogEventLevel.Warning,
        AppLogLevel.Error => LogEventLevel.Error,
        AppLogLevel.Fatal => LogEventLevel.Fatal,
        _ => LogEventLevel.Fatal,
    };

    private static bool IsChannel(LogEvent e, string channel) =>
        e.Properties.TryGetValue(Channel, out var v) && v is ScalarValue { Value: string s } && s == channel;
}

/// <summary>Writes LogHelper lines and audit-trail lines to Serilog with the fixed line fields.</summary>
internal sealed class SerilogLogSink(ILogger logger) : ILogSink
{
    public bool IsEnabled(AppLogLevel level) => logger.IsEnabled(HomeBellLogging.ToSerilog(level));

    public void Write(AppLogLevel level, Guid id, string plainText, string maskedSensitive, Exception? exception) =>
        logger
            .ForContext(HomeBellLogging.Channel, "app")
            .ForContext(HomeBellLogging.UniqueId, id)
            .ForContext(HomeBellLogging.PlainText, plainText)
            .ForContext(HomeBellLogging.Sensitive, maskedSensitive)
            .Write(HomeBellLogging.ToSerilog(level), exception, "{PlainText}", plainText);

    public void Audit(Guid id, string message) =>
        logger
            .ForContext(HomeBellLogging.Channel, "audit")
            .ForContext(HomeBellLogging.UniqueId, id)
            .ForContext(HomeBellLogging.PlainText, message)
            .ForContext(HomeBellLogging.Sensitive, string.Empty)
            .Information("{PlainText}", message);
}

/// <summary>
/// Fills LevelName (DEBUG/INFO/WARN/ERROR/FATAL) and, for framework events, UniqueId (trace id) and a
/// scrubbed PlainText so every line in the file has the same shape.
/// </summary>
internal sealed class LineFieldsEnricher : ILogEventEnricher
{
    private static readonly Serilog.Formatting.Display.MessageTemplateTextFormatter Literal =
        new("{Message:l}", System.Globalization.CultureInfo.InvariantCulture);

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var name = logEvent.Level switch
        {
            LogEventLevel.Verbose or LogEventLevel.Debug => "DEBUG",
            LogEventLevel.Information => "INFO",
            LogEventLevel.Warning => "WARN",
            LogEventLevel.Error => "ERROR",
            _ => "FATAL",
        };
        logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty(HomeBellLogging.LevelName, name));

        if (!logEvent.Properties.ContainsKey(HomeBellLogging.UniqueId))
        {
            var id = logEvent.TraceId?.ToHexString() is { } trace && trace.Length == 32
                ? new Guid(trace).ToString()
                : Guid.Empty.ToString();
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(HomeBellLogging.UniqueId, id));
        }

        if (!logEvent.Properties.ContainsKey(HomeBellLogging.PlainText))
        {
            using var writer = new StringWriter(System.Globalization.CultureInfo.InvariantCulture);
            Literal.Format(logEvent, writer); // strings unquoted, like log4net
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(HomeBellLogging.PlainText, SensitiveData.Scrub(writer.ToString())));
        }

        logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(HomeBellLogging.Sensitive, string.Empty));
    }
}
