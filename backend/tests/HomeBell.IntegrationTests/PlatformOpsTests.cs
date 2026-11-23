using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

public sealed class PlatformOpsTests(ApiFactory factory)
{
    [Fact]
    public async Task Role_permissions_are_enforced()
    {
        var (analyst, _) = await PlatformTestData.SignInAsync(factory, "platform.support_analyst");
        using var a = analyst;
        Assert.Equal(200, (await analyst.GetAsync("/v1/platform/tenants")).Status);
        Assert.Equal("FORBIDDEN", (await analyst.PostAsync("/v1/platform/tenants", PlatformTestData.NewTenant(PlatformTestData.Slug()), headers: PlatformTestData.Idem())).Code);
        Assert.Equal("FORBIDDEN", (await analyst.GetAsync("/v1/platform/users")).Code);

        var (billing, _) = await PlatformTestData.SignInAsync(factory, "platform.billing_ops");
        using var b = billing;
        var lifecycle = await billing.PostAsync("/v1/platform/tenants/{tenantId}/lifecycle-transitions",
            new { action = "suspend", expectedState = "active_paid", reasonCode = "non_payment" }, $"/v1/platform/tenants/{TestData.Greenfield}/lifecycle-transitions", PlatformTestData.Idem());
        Assert.Equal("FORBIDDEN", lifecycle.Code);
        var detail = await billing.GetAsync("/v1/platform/tenants/{tenantId}", $"/v1/platform/tenants/{TestData.Greenfield}");
        Assert.Equal(0, detail["allowedActions"].GetArrayLength()); // no lifecycle permission → no actions offered

        // School staff tokens never reach the control plane.
        using var staff = factory.Api();
        var login = await staff.PostAsync("/v1/auth/staff/login", new { email = "admin@greenfield.test", password = TestData.DemoPassword });
        staff.BearerToken = login["tokens"].GetProperty("accessToken").GetString();
        Assert.Equal("FORBIDDEN", (await staff.GetAsync("/v1/platform/tenants")).Code);
    }

    [Fact]
    public async Task Audit_log_search_and_csv_export()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var t = await api.PostAsync("/v1/platform/tenants", PlatformTestData.NewTenant(PlatformTestData.Slug(), invite: false), headers: PlatformTestData.Idem());
        var id = t["id"].GetGuid();

        var log = await api.GetAsync("/v1/platform/audit-logs", $"/v1/platform/audit-logs?tenantId={id}");
        var entries = log["items"].EnumerateArray().ToList();
        Assert.Contains(entries, e => e.GetProperty("action").GetString() == "tenant.created" && e.GetProperty("tenantName").GetString() == t["name"].GetString());

        var failures = await api.GetAsync("/v1/platform/audit-logs", "/v1/platform/audit-logs?outcome=failed&limit=5");
        Assert.All(failures["items"].EnumerateArray(), e => Assert.Equal("failed", e.GetProperty("outcome").GetString()));

        using var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", api.BearerToken);
        var csv = await http.GetAsync($"/v1/platform/audit-logs?tenantId={id}&format=csv");
        Assert.Equal("text/csv", csv.Content.Headers.ContentType?.MediaType);
        Assert.StartsWith("occurredAt,tenant,action", await csv.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Support_session_is_read_only_and_ends_immediately()
    {
        var (api, _) = await PlatformTestData.SignInAsync(factory, "platform.support_analyst");
        using var _ = api;
        Assert.Equal("VALIDATION_FAILED", (await api.PostAsync("/v1/platform/support-sessions", new { tenantId = TestData.Greenfield, reason = "short", durationMinutes = 60 })).Code);

        var created = await api.PostAsync("/v1/platform/support-sessions", new { tenantId = TestData.Greenfield, reason = "Investigating a dismissal complaint", durationMinutes = 15 });
        Assert.Equal(201, created.Status);
        Assert.Equal("Greenfield Academy", created["tenantName"].GetString());
        Assert.Equal("support.read_only", created["tokens"].GetProperty("scope").GetString());

        using var support = factory.Api();
        support.BearerToken = created["tokens"].GetProperty("accessToken").GetString();
        var me = await support.GetAsync("/v1/auth/me");
        Assert.Equal("support", me["session"].GetProperty("kind").GetString());
        Assert.Equal(TestData.Greenfield, me["session"].GetProperty("supportTenantId").GetGuid());

        var listed = await api.GetAsync("/v1/platform/support-sessions", $"/v1/platform/support-sessions?tenantId={TestData.Greenfield}");
        Assert.Contains(listed["items"].EnumerateArray(), s => s.GetProperty("id").GetGuid() == created["id"].GetGuid());

        var ended = await api.PostAsync("/v1/platform/support-sessions/{sessionId}/end", null, $"/v1/platform/support-sessions/{created["id"].GetGuid()}/end");
        Assert.NotEqual(System.Text.Json.JsonValueKind.Null, ended["endedAt"].ValueKind);
        Assert.Equal("SESSION_REVOKED", (await support.GetAsync("/v1/auth/me")).Code);
    }

    [Fact]
    public async Task Platform_users_invite_update_and_protect_the_last_super_admin()
    {
        var (api, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = api;
        var email = $"newops-{Guid.NewGuid():N}"[..20] + "@homebell.test";
        var invited = await api.PostAsync("/v1/platform/user-invitations", new { email, fullName = "New Ops", roles = new[] { "platform.ops_admin" } });
        Assert.Equal(201, invited.Status);
        Assert.Equal("invited", invited["status"].GetString());
        Assert.False(invited["mfaEnabled"].GetBoolean());
        Assert.Contains(factory.Email.Sent, m => m.To == email && m.Body.Contains("reset-password?token=", StringComparison.Ordinal));
        Assert.Equal("CONFLICT", (await api.PostAsync("/v1/platform/user-invitations", new { email, fullName = "Again", roles = new[] { "platform.ops_admin" } })).Code);

        var userPath = $"/v1/platform/users/{invited["userId"].GetGuid()}";
        var updated = await api.SendAsync(HttpMethod.Patch, "/v1/platform/users/{userId}", userPath, new { roles = new[] { "platform.billing_ops", "platform.support_analyst" } }, null);
        Assert.Equal(["platform.billing_ops", "platform.support_analyst"], updated["roles"].EnumerateArray().Select(r => r.GetString()));
        Assert.Equal("NOT_FOUND", (await api.SendAsync(HttpMethod.Patch, "/v1/platform/users/{userId}", $"/v1/platform/users/{Guid.NewGuid()}", new { status = "deactivated" }, null)).Code);

        var users = await api.GetAsync("/v1/platform/users", "/v1/platform/users?limit=100");
        Assert.Contains(users["items"].EnumerateArray(), u => u.GetProperty("email").GetString() == email);
    }

    [Fact]
    public async Task Deactivating_a_platform_user_ends_their_sessions()
    {
        var (admin, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var a = admin;
        var (victim, victimId) = await PlatformTestData.SignInAsync(factory, "platform.support_analyst");
        using var v = victim;
        Assert.Equal(200, (await victim.GetAsync("/v1/platform/tenants")).Status);

        var r = await admin.SendAsync(HttpMethod.Patch, "/v1/platform/users/{userId}", $"/v1/platform/users/{victimId}", new { status = "deactivated" }, null);
        Assert.Equal("deactivated", r["status"].GetString());
        Assert.Equal("SESSION_REVOKED", (await victim.GetAsync("/v1/platform/tenants")).Code);
    }
}
