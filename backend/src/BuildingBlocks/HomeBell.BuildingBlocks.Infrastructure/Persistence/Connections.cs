using System.Data;
using System.Data.Common;
using HomeBell.BuildingBlocks.Application;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace HomeBell.BuildingBlocks.Infrastructure.Persistence;

/// <summary>
/// Data sources: <see cref="App"/> connects as the RLS-restricted application role (not table owner, no
/// BYPASSRLS); <see cref="Owner"/> is used only by the migrator (docs/architecture/02-multitenancy.md §4.5).
/// </summary>
public sealed class HomeBellDataSources : IAsyncDisposable
{
    public HomeBellDataSources(string appConnectionString, string? ownerConnectionString)
    {
        App = new NpgsqlDataSourceBuilder(appConnectionString).Build();
        AppConnectionString = appConnectionString;
        OwnerConnectionString = ownerConnectionString;
    }

    public NpgsqlDataSource App { get; }

    public string AppConnectionString { get; }

    public string? OwnerConnectionString { get; }

    public ValueTask DisposeAsync() => App.DisposeAsync();
}

/// <summary>
/// One physical connection per request scope, shared by every module DbContext so they can join one
/// transaction (<see cref="UnitOfWork"/>). Tracks which tenant state has been applied to the session.
/// </summary>
public sealed class ConnectionScope : IAsyncDisposable
{
    public ConnectionScope(HomeBellDataSources sources)
    {
        ArgumentNullException.ThrowIfNull(sources);
        Connection = sources.App.CreateConnection();
    }

    public NpgsqlConnection Connection { get; }

    public NpgsqlTransaction? Transaction { get; internal set; }

    /// <summary>The <see cref="ITenantContext.Version"/> applied to the open session; -1 = none.</summary>
    internal int AppliedTenantVersion { get; set; } = -1;

    public ValueTask DisposeAsync() => Connection.DisposeAsync();
}

/// <summary>
/// Applies <c>app.tenant_id</c> / <c>app.cross_tenant</c> to the PostgreSQL session before a command
/// runs whenever the tenant context changed. RLS policies read these settings.
/// Npgsql resets session state (DISCARD ALL) when the connection returns to the pool.
/// </summary>
public sealed class TenantSessionInterceptor(ITenantContext tenant, ConnectionScope scope) : DbCommandInterceptor, IDbConnectionInterceptor
{
    public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        Apply(command.Connection!);
        return result;
    }

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        await ApplyAsync(command.Connection!, cancellationToken);
        return result;
    }

    public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        Apply(command.Connection!);
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        await ApplyAsync(command.Connection!, cancellationToken);
        return result;
    }

    public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
    {
        Apply(command.Connection!);
        return result;
    }

    public override async ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
    {
        await ApplyAsync(command.Connection!, cancellationToken);
        return result;
    }

    public void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData) => scope.AppliedTenantVersion = -1;

    public Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        scope.AppliedTenantVersion = -1;
        return Task.CompletedTask;
    }

    private void Apply(DbConnection connection)
    {
        if (scope.AppliedTenantVersion == tenant.Version)
        {
            return;
        }

        using var cmd = Build(connection);
        cmd.ExecuteNonQuery();
        scope.AppliedTenantVersion = tenant.Version;
    }

    private async Task ApplyAsync(DbConnection connection, CancellationToken ct)
    {
        if (scope.AppliedTenantVersion == tenant.Version)
        {
            return;
        }

        await using var cmd = Build(connection);
        await cmd.ExecuteNonQueryAsync(ct);
        scope.AppliedTenantVersion = tenant.Version;
    }

    private DbCommand Build(DbConnection connection)
    {
        var cmd = connection.CreateCommand();
        cmd.Transaction = scope.Transaction is { Connection: not null } tx && ReferenceEquals(tx.Connection, connection) ? tx : null;
        cmd.CommandText = "SELECT set_config('app.tenant_id', @t, false), set_config('app.cross_tenant', @c, false)";
        var t = cmd.CreateParameter();
        t.ParameterName = "t";
        t.Value = tenant.TenantId?.ToString() ?? string.Empty;
        var c = cmd.CreateParameter();
        c.ParameterName = "c";
        c.Value = tenant.IsCrossTenant ? "on" : "off";
        cmd.Parameters.Add(t);
        cmd.Parameters.Add(c);
        return cmd;
    }
}

/// <summary>Begins one transaction on the shared connection; module DbContexts enlist in it on SaveChanges.</summary>
public sealed class UnitOfWork(ConnectionScope scope) : IUnitOfWork
{
    public async Task<T> ExecuteAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(work);
        if (scope.Transaction is not null)
        {
            return await work(cancellationToken); // nested: join the outer transaction
        }

        if (scope.Connection.State != ConnectionState.Open)
        {
            await scope.Connection.OpenAsync(cancellationToken);
            scope.AppliedTenantVersion = -1;
        }

        await using var tx = await scope.Connection.BeginTransactionAsync(cancellationToken);
        scope.Transaction = tx;
        try
        {
            var result = await work(cancellationToken);
            await tx.CommitAsync(cancellationToken);
            return result;
        }
        catch
        {
            await tx.RollbackAsync(CancellationToken.None);
            scope.AppliedTenantVersion = -1; // set_config inside the rolled-back tx is undone
            throw;
        }
        finally
        {
            scope.Transaction = null;
        }
    }

    public Task ExecuteAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken) =>
        ExecuteAsync<bool>(async ct =>
        {
            await work(ct);
            return true;
        }, cancellationToken);
}
