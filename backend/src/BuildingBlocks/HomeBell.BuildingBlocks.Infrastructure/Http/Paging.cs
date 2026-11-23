using System.Text;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;

namespace HomeBell.BuildingBlocks.Infrastructure.Http;

/// <summary>
/// Contract pagination (PageMeta: nextCursor + limit). Cursors are opaque to clients; today they encode an
/// offset (keyset pagination is a later optimisation and may change the format without a contract change).
/// </summary>
public static class Paging
{
    public static int Limit(int? limit) => Math.Clamp(limit ?? 25, 1, 100);

    public static int Offset(string? cursor)
    {
        if (string.IsNullOrEmpty(cursor))
        {
            return 0;
        }

        try
        {
            var b64 = cursor.Replace('-', '+').Replace('_', '/');
            b64 = b64.PadRight(b64.Length + ((4 - (b64.Length % 4)) % 4), '=');
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
            if (raw.StartsWith("o:", StringComparison.Ordinal) && int.TryParse(raw[2..], out var offset) && offset >= 0)
            {
                return offset;
            }
        }
        catch (FormatException)
        {
        }

        throw new ApiProblemException(ErrorCodes.ValidationFailed, "Invalid cursor.", errors: [new FieldError("cursor", "invalid_format", "Cursor is not valid.")]);
    }

    public static string? Next(int offset, int limit, int fetched) =>
        fetched > limit ? Convert.ToBase64String(Encoding.UTF8.GetBytes($"o:{offset + limit}")).TrimEnd('=').Replace('+', '-').Replace('/', '_') : null;
}

/// <summary>Contract page envelope: PageMeta + items.</summary>
public sealed record Page<T>(IReadOnlyList<T> Items, string? NextCursor, int Limit, int? TotalEstimate = null);
