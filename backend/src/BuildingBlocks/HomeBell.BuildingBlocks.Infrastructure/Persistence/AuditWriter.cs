using System.Security.Cryptography;
using System.Text;
using HomeBell.BuildingBlocks.Application;
using Npgsql;
using NpgsqlTypes;

namespace HomeBell.BuildingBlocks.Infrastructure.Persistence;

/// <summary>
/// <see cref="IAuditWriter"/>: <see cref="Write"/> buffers rows that the next module SaveChanges persists in
/// the same transaction; anything still buffered when the request ends is flushed by
/// <see cref="FlushAsync"/>. Security events use <see cref="WriteImmediatelyAsync"/> (own transaction).
/// </summary>
public sealed class AuditWriter(AuditBuffer buffer, ICurrentActor actor, ITenantContext tenant, IClock clock, HomeBellDataSources sources) : IAuditWriter
{
    public void Write(AuditEntry entry) => buffer.Add(ToRecord(entry));

    public async Task WriteImmediatelyAsync(AuditEntry entry, CancellationToken cancellationToken)
    {
        await using var conn = await sources.App.OpenConnectionAsync(cancellationToken);
        await InsertAsync(conn, [ToRecord(entry)], cancellationToken);
    }

    /// <summary>Persists rows no SaveChanges picked up (e.g. read-only endpoints that audit an access).</summary>
    public async Task FlushAsync(CancellationToken cancellationToken)
    {
        var rows = buffer.Drain();
        if (rows.Count == 0)
        {
            return;
        }

        await using var conn = await sources.App.OpenConnectionAsync(cancellationToken);
        await InsertAsync(conn, rows, cancellationToken);
    }

    private AuditLogRecord ToRecord(AuditEntry e)
    {
        var type = actor.IsAuthenticated ? actor.Type.ToString().ToLowerInvariant() : "system";
        return new AuditLogRecord
        {
            Id = Guid.CreateVersion7(),
            OccurredAt = clock.UtcNow,
            TenantId = e.TenantId ?? tenant.TenantId,
            ActorType = type,
            ActorId = e.ActorIdOverride ?? actor.Id,
            ActorDisplay = e.ActorDisplayOverride ?? (actor.IsAuthenticated ? actor.DisplayName : "System"),
            Action = e.Action,
            TargetType = e.TargetType,
            TargetId = e.TargetId,
            Outcome = e.Outcome,
            ReasonCode = e.ReasonCode,
            IpHash = HashIp(actor.IpAddress),
            UserAgent = actor.UserAgent is { Length: > 300 } ua ? ua[..300] : actor.UserAgent,
            DeviceId = actor.DeviceId,
            RequestId = actor.RequestId,
            Data = AuditBuffer.Serialize(e.Data),
        };
    }

    private static string? HashIp(string? ip) =>
        ip is null ? null : Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("hb-ip:" + ip)))[..32];

    private static async Task InsertAsync(NpgsqlConnection conn, IReadOnlyList<AuditLogRecord> rows, CancellationToken ct)
    {
        foreach (var r in rows)
        {
            await using var cmd = new NpgsqlCommand(
                """
                INSERT INTO audit.audit_log (id, occurred_at, tenant_id, actor_type, actor_id, actor_display, on_behalf_of,
                  action, target_type, target_id, outcome, reason_code, ip_hash, user_agent, device_id, request_id, data)
                VALUES (@id, @at, @tenant, @atype, @aid, @adisp, @obo, @action, @ttype, @tid, @outcome, @reason, @ip, @ua, @dev, @req, @data)
                """, conn);
            cmd.Parameters.AddWithValue("id", r.Id);
            cmd.Parameters.AddWithValue("at", r.OccurredAt);
            cmd.Parameters.AddWithValue("tenant", (object?)r.TenantId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("atype", r.ActorType);
            cmd.Parameters.AddWithValue("aid", (object?)r.ActorId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("adisp", r.ActorDisplay);
            cmd.Parameters.AddWithValue("obo", (object?)r.OnBehalfOf ?? DBNull.Value);
            cmd.Parameters.AddWithValue("action", r.Action);
            cmd.Parameters.AddWithValue("ttype", (object?)r.TargetType ?? DBNull.Value);
            cmd.Parameters.AddWithValue("tid", (object?)r.TargetId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("outcome", r.Outcome);
            cmd.Parameters.AddWithValue("reason", (object?)r.ReasonCode ?? DBNull.Value);
            cmd.Parameters.AddWithValue("ip", (object?)r.IpHash ?? DBNull.Value);
            cmd.Parameters.AddWithValue("ua", (object?)r.UserAgent ?? DBNull.Value);
            cmd.Parameters.AddWithValue("dev", (object?)r.DeviceId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("req", (object?)r.RequestId ?? DBNull.Value);
            cmd.Parameters.Add(new NpgsqlParameter("data", NpgsqlDbType.Jsonb) { Value = r.Data });
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
