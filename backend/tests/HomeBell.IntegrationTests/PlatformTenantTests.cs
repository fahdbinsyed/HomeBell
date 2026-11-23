using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

public sealed class PlatformTenantTests(ApiFactory factory)
{
    private const string Tenants = "/v1/platform/tenants";
    private const string Tenant = "/v1/platform/tenants/{tenantId}";
    private const string Transitions = "/v1/platform/tenants/{tenantId}/lifecycle-transitions";

    private static string T(string template, Guid id) => template.Replace("{tenantId}", id.ToString(), StringComparison.Ordinal);

    private static async Task<ApiResponse> TransitionAsync(ApiClient api, Guid id, object body) =>
        await api.PostAsync(Transitions, body, T(Transitions, id), PlatformTestData.Idem());

    [Fact]
    public async Task Create_is_idempotent_and_invites_the_school_admin()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var slug = PlatformTestData.Slug();
        var key = PlatformTestData.Idem();

        var created = await api.PostAsync(Tenants, PlatformTestData.NewTenant(slug), headers: key);
        Assert.Equal(201, created.Status);
        Assert.Equal("draft", created["state"].GetString());
        Assert.Equal("setup", created["operationalMode"].GetString());
        Assert.Contains("setup_incomplete", created["flags"].EnumerateArray().Select(f => f.GetString()));
        Assert.Contains("start_trial", created["allowedActions"].EnumerateArray().Select(a => a.GetString()));
        Assert.Contains(factory.Email.Sent, m => m.To == $"principal@{slug}.test" && m.Body.Contains("/invite/staff?token=", StringComparison.Ordinal));

        var replay = await api.PostAsync(Tenants, PlatformTestData.NewTenant(slug), headers: key);
        Assert.Equal(201, replay.Status);
        Assert.Equal(created["id"].GetGuid(), replay["id"].GetGuid());

        var reused = await api.PostAsync(Tenants, PlatformTestData.NewTenant(PlatformTestData.Slug()), headers: key);
        Assert.Equal("IDEMPOTENCY_KEY_REUSED", reused.Code);

        Assert.Equal("IDEMPOTENCY_KEY_REQUIRED", (await api.PostAsync(Tenants, PlatformTestData.NewTenant(PlatformTestData.Slug()))).Code);
        Assert.Equal("TENANT_SLUG_TAKEN", (await api.PostAsync(Tenants, PlatformTestData.NewTenant(slug), headers: PlatformTestData.Idem())).Code);
    }

    [Fact]
    public async Task Create_validates_input()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var bad = await api.PostAsync(Tenants, new { name = "X", slug = "Bad Slug", countryCode = "usa", initialState = "trial" }, headers: PlatformTestData.Idem());
        Assert.Equal("VALIDATION_FAILED", bad.Code);
        var fields = bad["errors"].EnumerateArray().Select(e => e.GetProperty("field").GetString()).ToHashSet();
        Assert.Superset(new HashSet<string?> { "name", "slug", "countryCode", "region", "timezone", "termStartDate", "expiresAt", "primaryContact" }, fields);
    }

    [Fact]
    public async Task Lifecycle_follows_the_transition_table()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var t = await api.PostAsync(Tenants, PlatformTestData.NewTenant(PlatformTestData.Slug(), invite: false), headers: PlatformTestData.Idem());
        var id = t["id"].GetGuid();
        var expires = DateTimeOffset.UtcNow.AddDays(30);

        var stale = await TransitionAsync(api, id, new { action = "start_trial", expectedState = "trial", reasonCode = "trial_requested", expiresAt = expires });
        Assert.Equal("LIFECYCLE_STATE_CHANGED", stale.Code);
        Assert.Equal("draft", stale["meta"].GetProperty("currentState").GetString());

        var invalid = await TransitionAsync(api, id, new { action = "suspend", expectedState = "draft", reasonCode = "non_payment" });
        Assert.Equal("INVALID_LIFECYCLE_TRANSITION", invalid.Code);
        Assert.Contains("start_trial", invalid["meta"].GetProperty("allowedActions").EnumerateArray().Select(a => a.GetString()));

        Assert.Equal("VALIDATION_FAILED", (await TransitionAsync(api, id, new { action = "start_trial", expectedState = "draft", reasonCode = "trial_requested" })).Code);

        var trial = await TransitionAsync(api, id, new { action = "start_trial", expectedState = "draft", reasonCode = "trial_requested", expiresAt = expires });
        Assert.Equal("trial", trial["state"].GetString());
        Assert.Equal("full", trial["operationalMode"].GetString());

        var suspended = await TransitionAsync(api, id, new { action = "suspend", expectedState = "trial", reasonCode = "non_payment" });
        Assert.Equal("read_only", suspended["operationalMode"].GetString());
        Assert.Equal("trial", suspended["previousOperationalState"].GetString());

        var noConfirm = await TransitionAsync(api, id, new { action = "deactivate", expectedState = "suspended", reasonCode = "school_request" });
        Assert.Equal("confirmTenantName", noConfirm["errors"][0].GetProperty("field").GetString());

        var reinstated = await TransitionAsync(api, id, new { action = "reinstate", expectedState = "suspended", reasonCode = "renewal" });
        Assert.Equal("trial", reinstated["state"].GetString());

        Assert.Equal("PLAN_VERSION_NOT_PUBLISHED", (await TransitionAsync(api, id, new { action = "convert_to_paid", expectedState = "trial", reasonCode = "contract_signed", expiresAt = expires.AddDays(300) })).Code);

        var history = await api.GetAsync("/v1/platform/tenants/{tenantId}/lifecycle-history", T("/v1/platform/tenants/{tenantId}/lifecycle-history", id));
        Assert.Equal(["reinstate", "suspend", "start_trial", "create"], history["items"].EnumerateArray().Select(h => h.GetProperty("action").GetString()));
    }

    [Fact]
    public async Task Patch_honours_if_match()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var t = await api.PostAsync(Tenants, PlatformTestData.NewTenant(PlatformTestData.Slug(), invite: false), headers: PlatformTestData.Idem());
        var id = t["id"].GetGuid();

        using var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", api.BearerToken);
        var etag = (await http.GetAsync(T(Tenant, id))).Headers.ETag!.Tag;

        var ok = await api.SendAsync(HttpMethod.Patch, Tenant, T(Tenant, id), new { name = "Renamed School" }, new Dictionary<string, string> { ["If-Match"] = etag });
        Assert.Equal(200, ok.Status);
        Assert.Equal("Renamed School", ok["name"].GetString());

        var stale = await api.SendAsync(HttpMethod.Patch, Tenant, T(Tenant, id), new { name = "Again" }, new Dictionary<string, string> { ["If-Match"] = etag });
        Assert.Equal("PRECONDITION_FAILED", stale.Code);
    }

    [Fact]
    public async Task List_filters_sorts_and_paginates()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var page1 = await api.GetAsync(Tenants, $"{Tenants}?limit=2&sort=name");
        Assert.Equal(2, page1["items"].GetArrayLength());
        var next = page1["nextCursor"].GetString();
        Assert.NotNull(next);
        var page2 = await api.GetAsync(Tenants, $"{Tenants}?limit=2&sort=name&cursor={next}");
        Assert.DoesNotContain(page2["items"].EnumerateArray().Select(i => i.GetProperty("id").GetGuid()), id => page1["items"].EnumerateArray().Any(p => p.GetProperty("id").GetGuid() == id));

        var suspended = await api.GetAsync(Tenants, $"{Tenants}?state=suspended&q=hill");
        Assert.All(suspended["items"].EnumerateArray(), i => Assert.Equal("suspended", i.GetProperty("state").GetString()));
        Assert.Contains(suspended["items"].EnumerateArray(), i => i.GetProperty("slug").GetString() == "hillcrest");

        var gf = await api.GetAsync(Tenant, T(Tenant, TestData.Greenfield));
        Assert.Equal("Standard", gf["planName"].GetString());
        Assert.Equal("Standard", gf["subscription"].GetProperty("planVersion").GetProperty("planName").GetString());
    }

    [Fact]
    public async Task Unknown_tenant_is_not_found()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        Assert.Equal("NOT_FOUND", (await api.GetAsync(Tenant, T(Tenant, Guid.NewGuid()))).Code);
    }
}
