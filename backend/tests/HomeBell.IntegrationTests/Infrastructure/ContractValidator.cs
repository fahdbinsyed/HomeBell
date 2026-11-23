using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;
using YamlDotNet.Serialization;

namespace HomeBell.IntegrationTests.Infrastructure;

/// <summary>
/// Validates real API responses against packages/contracts/bundled/openapi.v1.yaml: the status code must be
/// documented for the operation and the body must match the documented schema (JSON Schema 2020-12,
/// which OpenAPI 3.1 schemas are). The hand-authored contract wins over the implementation (ADR-0004).
/// </summary>
public static class ContractValidator
{
    private static readonly Lazy<JsonObject> Spec = new(Load);
    private static readonly Dictionary<string, JsonSchema> Cache = new(StringComparer.Ordinal);
    private static readonly Lock Gate = new();

    public static void AssertResponse(string method, string pathTemplate, int status, string? body, string? contentType)
    {
        var operation = Spec.Value["paths"]?[pathTemplate]?[method.ToLowerInvariant()]
            ?? throw new Xunit.Sdk.XunitException($"Contract has no operation {method} {pathTemplate}.");
        var responses = operation["responses"]!.AsObject();
        var response = responses[status.ToString(System.Globalization.CultureInfo.InvariantCulture)] ?? responses["default"]
            ?? throw new Xunit.Sdk.XunitException(
                $"{method} {pathTemplate} returned {status}, which the contract does not document (documented: {string.Join(", ", responses.Select(r => r.Key))}). Body: {Truncate(body)}");
        response = Deref(response);

        var content = response["content"]?.AsObject();
        if (content is null || content.Count == 0)
        {
            Assert.True(string.IsNullOrEmpty(body), $"{method} {pathTemplate} {status}: contract documents no body but got: {Truncate(body)}");
            return;
        }

        Assert.False(string.IsNullOrEmpty(body), $"{method} {pathTemplate} {status}: contract documents a body but none was returned.");
        var media = content.FirstOrDefault(c => contentType?.StartsWith(c.Key, StringComparison.OrdinalIgnoreCase) == true);
        Assert.True(media.Value is not null, $"{method} {pathTemplate} {status}: content type '{contentType}' not in contract ({string.Join(", ", content.Select(c => c.Key))}).");

        var schema = SchemaFor($"{method} {pathTemplate} {status} {media.Key}", media.Value!["schema"]!);
        using var doc = JsonDocument.Parse(body!);
        var result = schema.Evaluate(doc.RootElement, new EvaluationOptions { OutputFormat = OutputFormat.List });
        if (!result.IsValid)
        {
            var errors = (result.Details ?? [])
                .Where(d => d.Errors is { Count: > 0 })
                .SelectMany(d => d.Errors!.Select(e => $"  {d.InstanceLocation}: {e.Value}"))
                .Distinct()
                .Take(15);
            throw new Xunit.Sdk.XunitException(
                $"{method} {pathTemplate} {status} does not match the contract schema:\n{string.Join('\n', errors)}\nBody: {Truncate(body)}");
        }
    }

    private static JsonSchema SchemaFor(string key, JsonNode schemaNode)
    {
        lock (Gate)
        {
            if (!Cache.TryGetValue(key, out var schema))
            {
                var inlined = Inline(schemaNode, []);
                inlined!["$schema"] = "https://json-schema.org/draft/2020-12/schema";
                schema = JsonSchema.FromText(inlined.ToJsonString());
                Cache[key] = schema;
            }

            return schema;
        }
    }

    /// <summary>Replaces local $refs with copies of their targets; drops OpenAPI-only keywords.</summary>
    private static JsonNode? Inline(JsonNode? node, HashSet<string> stack)
    {
        switch (node)
        {
            case JsonObject obj when obj["$ref"] is JsonValue refValue && refValue.TryGetValue<string>(out var reference):
                if (!stack.Add(reference))
                {
                    return new JsonObject(); // recursive schema: accept at the cycle point
                }

                var target = Inline(Resolve(reference), stack);
                stack.Remove(reference);
                return target;
            case JsonObject obj:
                var copy = new JsonObject();
                foreach (var (k, v) in obj)
                {
                    if (k is "discriminator" or "example" or "examples" or "xml" or "externalDocs")
                    {
                        continue;
                    }

                    copy[k] = Inline(v, stack);
                }

                return copy;
            case JsonArray arr:
                return new JsonArray(arr.Select(i => Inline(i, stack)).ToArray());
            default:
                return node?.DeepClone();
        }
    }

    private static JsonNode Deref(JsonNode node) =>
        node["$ref"] is JsonValue v && v.TryGetValue<string>(out var r) ? Deref(Resolve(r)) : node;

    private static JsonNode Resolve(string reference)
    {
        if (!reference.StartsWith("#/", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Only local refs are supported in the bundled spec: {reference}");
        }

        JsonNode current = Spec.Value;
        foreach (var part in reference[2..].Split('/'))
        {
            current = current[part.Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal)]
                ?? throw new InvalidOperationException($"Unresolvable ref {reference}");
        }

        return current;
    }

    private static JsonObject Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "contract", "openapi.v1.yaml");
        var yaml = new DeserializerBuilder().WithAttemptingUnquotedStringTypeDeserialization().Build().Deserialize<object>(File.ReadAllText(path));
        var json = new SerializerBuilder().JsonCompatible().Build().Serialize(yaml);
        return JsonNode.Parse(json)!.AsObject();
    }

    private static string Truncate(string? s) => s is null ? "<null>" : s.Length > 600 ? s[..600] + "…" : s;
}
