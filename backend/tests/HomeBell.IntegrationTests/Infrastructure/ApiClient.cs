using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace HomeBell.IntegrationTests.Infrastructure;

public sealed record ApiResponse(int Status, JsonElement Body, string Raw)
{
    public string? Code => Body.ValueKind == JsonValueKind.Object && Body.TryGetProperty("code", out var c) ? c.GetString() : null;

    public JsonElement this[string name] => Body.GetProperty(name);
}

/// <summary>HTTP client that validates every response against the contract operation it called.</summary>
public sealed class ApiClient(HttpClient http) : IDisposable
{
    public string? BearerToken { get; set; }

    public Guid? DeviceId { get; set; }

    public Task<ApiResponse> PostAsync(string template, object? body = null, string? path = null, IDictionary<string, string>? headers = null) =>
        SendAsync(HttpMethod.Post, template, path, body, headers);

    public Task<ApiResponse> GetAsync(string template, string? path = null) => SendAsync(HttpMethod.Get, template, path, null, null);

    public async Task<ApiResponse> SendAsync(HttpMethod method, string template, string? path, object? body, IDictionary<string, string>? headers)
    {
        using var req = new HttpRequestMessage(method, path ?? template);
        if (body is not null)
        {
            req.Content = JsonContent.Create(body, options: new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }

        if (BearerToken is not null)
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", BearerToken);
        }

        if (DeviceId is { } device)
        {
            req.Headers.Add("X-Device-Id", device.ToString());
        }

        foreach (var (k, v) in headers ?? new Dictionary<string, string>())
        {
            req.Headers.Add(k, v);
        }

        using var res = await http.SendAsync(req);
        var raw = await res.Content.ReadAsStringAsync();
        ContractValidator.AssertResponse(method.Method, template, (int)res.StatusCode, raw, res.Content.Headers.ContentType?.MediaType);
        var json = string.IsNullOrEmpty(raw) ? default : JsonDocument.Parse(raw).RootElement.Clone();
        return new ApiResponse((int)res.StatusCode, json, raw);
    }

    public void Dispose() => http.Dispose();
}
