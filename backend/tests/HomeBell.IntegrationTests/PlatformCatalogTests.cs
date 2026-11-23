using System.Text.Json;
using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

public sealed class PlatformCatalogTests(ApiFactory factory)
{
    private static string T(string template, Guid tenantId) => template.Replace("{tenantId}", tenantId.ToString(), StringComparison.Ordinal);

    private static JsonElement Feature(ApiResponse e, string key) => e["features"].EnumerateArray().Single(f => f.GetProperty("key").GetString() == key);

    private static JsonElement Limit(ApiResponse e, string key) => e["limits"].EnumerateArray().Single(f => f.GetProperty("key").GetString() == key);

    [Fact]
    public async Task Plans_versions_publish_retire_and_subscriptions()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var code = $"plan_{Guid.NewGuid():N}"[..20];
        var plan = await api.PostAsync("/v1/platform/plans", new { code, name = "Pilot", isPublic = false });
        Assert.Equal(201, plan.Status);
        Assert.Equal("CONFLICT", (await api.PostAsync("/v1/platform/plans", new { code, name = "Dup", isPublic = false })).Code);
        var planId = plan["id"].GetGuid();
        var versionsPath = $"/v1/platform/plans/{planId}/versions";

        var bad = await api.PostAsync("/v1/platform/plans/{planId}/versions", new { price = new { amountMinor = 100, currency = "USD" }, features = new Dictionary<string, bool> { ["nope.feature"] = true }, limits = new { } }, versionsPath);
        Assert.Equal("VALIDATION_FAILED", bad.Code);

        var v1 = await api.PostAsync("/v1/platform/plans/{planId}/versions",
            new { price = new { amountMinor = 99_00, currency = "USD" }, features = new Dictionary<string, bool> { ["dismissal.queue"] = true, ["reports.export"] = false }, limits = new Dictionary<string, int?> { ["students.max"] = 300, ["staff.max"] = null } }, versionsPath);
        Assert.Equal(201, v1.Status);
        Assert.Equal(1, v1["version"].GetInt32());
        Assert.Equal("draft", v1["status"].GetString());
        var vId = v1["id"].GetGuid();

        var tenant = await api.PostAsync("/v1/platform/tenants", PlatformTestData.NewTenant(PlatformTestData.Slug(), invite: false), headers: PlatformTestData.Idem());
        var tId = tenant["id"].GetGuid();
        var sub = new { planVersionId = vId, startsAt = DateTimeOffset.UtcNow, endsAt = DateTimeOffset.UtcNow.AddYears(1), billingReference = "PO-42" };
        Assert.Equal("PLAN_VERSION_NOT_PUBLISHED", (await api.SendAsync(HttpMethod.Put, "/v1/platform/tenants/{tenantId}/subscription", T("/v1/platform/tenants/{tenantId}/subscription", tId), sub, null)).Code);

        var published = await api.PostAsync("/v1/platform/plans/{planId}/versions/{versionId}/publish", null, $"{versionsPath}/{vId}/publish");
        Assert.Equal("published", published["status"].GetString());
        Assert.Equal("CONFLICT", (await api.PostAsync("/v1/platform/plans/{planId}/versions/{versionId}/publish", null, $"{versionsPath}/{vId}/publish")).Code);

        var set = await api.SendAsync(HttpMethod.Put, "/v1/platform/tenants/{tenantId}/subscription", T("/v1/platform/tenants/{tenantId}/subscription", tId), sub, null);
        Assert.Equal(200, set.Status);
        Assert.Equal("PO-42", set["billingReference"].GetString());

        var ent = await api.GetAsync("/v1/platform/tenants/{tenantId}/entitlements", T("/v1/platform/tenants/{tenantId}/entitlements", tId));
        Assert.Equal(300, Limit(ent, "students.max").GetProperty("value").GetInt32());
        Assert.Equal("plan", Limit(ent, "students.max").GetProperty("source").GetString());
        Assert.False(Feature(ent, "reports.export").GetProperty("enabled").GetBoolean());

        var retired = await api.PostAsync("/v1/platform/plans/{planId}/versions/{versionId}/retire", null, $"{versionsPath}/{vId}/retire");
        Assert.Equal("retired", retired["status"].GetString());
        var listed = await api.GetAsync("/v1/platform/plans");
        Assert.Contains(listed["items"].EnumerateArray(), p => p.GetProperty("code").GetString() == code && p.GetProperty("versions").GetArrayLength() == 1);
    }

    [Fact]
    public async Task Entitlements_combine_plan_overrides_flags_and_lifecycle()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var tenant = await api.PostAsync("/v1/platform/tenants",
            PlatformTestData.NewTenant(PlatformTestData.Slug(), "trial", DateTimeOffset.UtcNow.AddDays(30), invite: false, planVersionId: HomeBell.Api.DevSeeder.StandardV1), headers: PlatformTestData.Idem());
        var id = tenant["id"].GetGuid();
        var ents = T("/v1/platform/tenants/{tenantId}/entitlements", id);
        var ovPath = T("/v1/platform/tenants/{tenantId}/entitlement-overrides", id);

        var before = await api.GetAsync("/v1/platform/tenants/{tenantId}/entitlements", ents);
        Assert.Equal(2000, Limit(before, "students.max").GetProperty("value").GetInt32());

        var ov = await api.PostAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides", new { kind = "limit", key = "students.max", value = 200, reasonCode = "pilot_program", note = "Pilot cap" }, ovPath);
        Assert.Equal(201, ov.Status);
        Assert.Equal("VALIDATION_FAILED", (await api.PostAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides", new { kind = "feature", key = "reports.export", value = 5, reasonCode = "other", note = "x" }, ovPath)).Code);
        await api.PostAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides", new { kind = "feature", key = "reports.export", value = false, reasonCode = "other", note = "No exports during pilot" }, ovPath);

        var after = await api.GetAsync("/v1/platform/tenants/{tenantId}/entitlements", ents);
        Assert.Equal(200, Limit(after, "students.max").GetProperty("value").GetInt32());
        Assert.Equal("override", Limit(after, "students.max").GetProperty("source").GetString());
        Assert.Equal("override", Feature(after, "reports.export").GetProperty("source").GetString());

        // A global flag can only restrict.
        var flag = await api.SendAsync(HttpMethod.Put, "/v1/platform/feature-flags/{flagKey}", "/v1/platform/feature-flags/branding.custom",
            new { enabledByDefault = true, tenantAllowList = Array.Empty<Guid>(), tenantDenyList = new[] { id }, note = "Branding rollout paused here" }, null);
        Assert.Equal(200, flag.Status);
        var flagged = await api.GetAsync("/v1/platform/tenants/{tenantId}/entitlements", ents);
        Assert.False(Feature(flagged, "branding.custom").GetProperty("enabled").GetBoolean());
        Assert.Equal("flag", Feature(flagged, "branding.custom").GetProperty("source").GetString());
        await api.SendAsync(HttpMethod.Put, "/v1/platform/feature-flags/{flagKey}", "/v1/platform/feature-flags/branding.custom",
            new { enabledByDefault = true, tenantAllowList = Array.Empty<Guid>(), tenantDenyList = Array.Empty<Guid>(), note = "Restore" }, null);

        // Lifecycle gate: a suspended tenant loses the dismissal features.
        await api.PostAsync("/v1/platform/tenants/{tenantId}/lifecycle-transitions", new { action = "suspend", expectedState = "trial", reasonCode = "non_payment" },
            T("/v1/platform/tenants/{tenantId}/lifecycle-transitions", id), PlatformTestData.Idem());
        var gated = await api.GetAsync("/v1/platform/tenants/{tenantId}/entitlements", ents);
        Assert.Equal("read_only", gated["operationalMode"].GetString());
        Assert.Equal("lifecycle", Feature(gated, "dismissal.queue").GetProperty("source").GetString());

        // Revoke → back to the plan value; revoking twice conflicts.
        var revokePath = $"{ovPath}/{ov["id"].GetGuid()}/revoke";
        Assert.Equal(200, (await api.PostAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides/{overrideId}/revoke", new { note = "Pilot over" }, revokePath)).Status);
        Assert.Equal("CONFLICT", (await api.PostAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides/{overrideId}/revoke", new { note = "Again" }, revokePath)).Code);
        var active = await api.GetAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides", $"{ovPath}?activeOnly=true");
        Assert.Single(active["items"].EnumerateArray());
        Assert.Equal(2000, Limit(await api.GetAsync("/v1/platform/tenants/{tenantId}/entitlements", ents), "students.max").GetProperty("value").GetInt32());
    }

    [Fact]
    public async Task Usage_and_notes()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var usage = await api.GetAsync("/v1/platform/tenants/{tenantId}/usage", T("/v1/platform/tenants/{tenantId}/usage", TestData.Greenfield));
        Assert.True(usage["staff"].GetProperty("used").GetInt32() >= 2);
        Assert.Equal(50, usage["staff"].GetProperty("limit").GetInt32());
        Assert.Equal(1, usage["guardians"].GetProperty("blocked").GetInt32());

        var notes = T("/v1/platform/tenants/{tenantId}/notes", TestData.Riverside);
        await api.PostAsync("/v1/platform/tenants/{tenantId}/notes", new { category = "billing", body = "Invoice sent" }, notes);
        var pinned = await api.PostAsync("/v1/platform/tenants/{tenantId}/notes", new { category = "refund", body = "Refund handled by finance, outside HomeBell", refundStatus = "refund_handled_manually", pinned = true }, notes);
        Assert.Equal(201, pinned.Status);
        var list = await api.GetAsync("/v1/platform/tenants/{tenantId}/notes", notes);
        Assert.True(list["items"][0].GetProperty("pinned").GetBoolean());
        var refunds = await api.GetAsync("/v1/platform/tenants/{tenantId}/notes", $"{notes}?category=refund");
        Assert.All(refunds["items"].EnumerateArray(), n => Assert.Equal("refund", n.GetProperty("category").GetString()));
    }
}
