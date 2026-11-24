using System.Text.Json;
using System.Text.Json.Nodes;
using HomeBell.IntegrationTests.Infrastructure;
using HomeBell.Modules.Notifications.Contracts;
using Microsoft.Extensions.DependencyInjection;

namespace HomeBell.IntegrationTests;

public sealed class GuardianMeTests(ApiFactory factory)
{
    /// <summary>Opens dismissal all day, every day, so eligibility does not depend on when the test runs.</summary>
    private static async Task OpenAllDayAsync(ApiFactory factory, TestSchool school)
    {
        using var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", school.Admin.BearerToken);
        var settings = JsonNode.Parse(await (await http.GetAsync(school.P("/settings"))).Content.ReadAsStringAsync())!;
        settings["dismissal"]!["windows"] = new JsonArray(Enumerable.Range(1, 7).Select(d => (JsonNode)new JsonObject { ["dayOfWeek"] = d, ["opensAt"] = "00:00", ["closesAt"] = "23:59" }).ToArray());
        Assert.Equal(200, (await school.Admin.SendAsync(HttpMethod.Put, "/v1/t/{tenantId}/settings", school.P("/settings"), settings, null)).Status);
    }

    private static async Task<JsonElement> ChildrenAsync(ApiClient guardian) => (await guardian.GetAsync("/v1/me/children")).Body;

    private static string? Reason(JsonElement children, string firstName) =>
        children.GetProperty("items").EnumerateArray().Single(c => c.GetProperty("firstName").GetString() == firstName).GetProperty("pickup").GetProperty("reasonCode").GetString();

    [Fact]
    public async Task Me_endpoints_require_the_bound_device()
    {
        var phone = TestData.NewPhone();
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, phone);
        var (guardian, _) = await TestData.GuardianSignInAsync(factory, phone);
        using var g = guardian;
        Assert.Equal(200, (await guardian.GetAsync("/v1/me/profile")).Status);

        var bound = guardian.DeviceId;
        guardian.DeviceId = null;
        Assert.Equal("DEVICE_ID_REQUIRED", (await guardian.GetAsync("/v1/me/profile")).Code);
        guardian.DeviceId = Guid.NewGuid();
        Assert.Equal("DEVICE_MISMATCH", (await guardian.GetAsync("/v1/me/children")).Code);
        guardian.DeviceId = bound;

        // Staff tokens cannot use guardian endpoints, and guardian tokens cannot use staff ones.
        using var staff = factory.Api();
        var login = await staff.PostAsync("/v1/auth/staff/login", new { email = "admin@greenfield.test", password = TestData.DemoPassword });
        staff.BearerToken = login["tokens"].GetProperty("accessToken").GetString();
        staff.DeviceId = Guid.NewGuid();
        Assert.Equal("FORBIDDEN", (await staff.GetAsync("/v1/me/children")).Code);
        Assert.Equal("FORBIDDEN", (await guardian.GetAsync("/v1/t/{tenantId}/students", $"/v1/t/{TestData.Greenfield}/students")).Code);
    }

    [Fact]
    public async Task Children_across_schools_with_pickup_eligibility()
    {
        var a = await SchoolTestData.NewSchoolAsync(factory);
        var b = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = a.Admin;
        using var __ = b.Admin;
        await OpenAllDayAsync(factory, a);
        var phone = TestData.NewPhone();
        var aClass = await SchoolTestData.ClassAsync(a);
        var kidA = await SchoolTestData.StudentAsync(a, aClass, "Amira", phone);
        var heldA = await SchoolTestData.StudentAsync(a, aClass, "Hana", TestData.NewPhone());
        var bClass = await SchoolTestData.ClassAsync(b);
        await SchoolTestData.StudentAsync(b, bClass, "Bilal", phone);

        // The guardian also looks after Hana (not primary) and Hana is on hold.
        var guardianId = kidA.GetProperty("primaryGuardian").GetProperty("guardianId").GetGuid();
        await a.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/links", new { studentId = heldA.GetProperty("id").GetGuid(), relationship = "aunt_uncle", isPrimary = false }, a.P($"/guardians/{guardianId}/links"));
        await a.Admin.SendAsync(HttpMethod.Patch, "/v1/t/{tenantId}/students/{studentId}", a.P($"/students/{heldA.GetProperty("id").GetGuid()}"), new { dismissalEligibility = "hold" }, null);

        // School B: no dismissal window on any day.
        using (var http = factory.CreateClient())
        {
            http.DefaultRequestHeaders.Authorization = new("Bearer", b.Admin.BearerToken);
            var s = JsonNode.Parse(await (await http.GetAsync(b.P("/settings"))).Content.ReadAsStringAsync())!;
            s["dismissal"]!["windows"] = new JsonArray();
            await b.Admin.SendAsync(HttpMethod.Put, "/v1/t/{tenantId}/settings", b.P("/settings"), s, null);
        }

        var (guardian, verify) = await TestData.GuardianSignInAsync(factory, phone);
        using var g = guardian;
        Assert.Equal(2, verify["activatedProfiles"].GetArrayLength());

        var children = await ChildrenAsync(guardian);
        Assert.Equal(3, children.GetProperty("items").GetArrayLength());
        Assert.Equal(2, children.GetProperty("tenants").GetArrayLength());
        Assert.Null(Reason(children, "Amira"));
        Assert.Equal("STUDENT_NOT_ELIGIBLE", Reason(children, "Hana"));
        Assert.Equal("OUTSIDE_DISMISSAL_WINDOW", Reason(children, "Bilal"));
        var amira = children.GetProperty("items").EnumerateArray().Single(c => c.GetProperty("firstName").GetString() == "Amira");
        Assert.True(amira.GetProperty("pickup").GetProperty("eligible").GetBoolean());
        Assert.Equal("primary", amira.GetProperty("myRole").GetString());
        Assert.True(children.GetProperty("tenants").EnumerateArray().All(t => t.GetProperty("guardianState").GetString() == "active"));

        // Blocking at school A affects only school A.
        await a.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/block", new { reason = "Court order" }, a.P($"/guardians/{guardianId}/block"));
        children = await ChildrenAsync(guardian);
        Assert.Equal("GUARDIAN_BLOCKED", Reason(children, "Amira"));
        Assert.Equal("OUTSIDE_DISMISSAL_WINDOW", Reason(children, "Bilal"));

        // A suspended school is not operational.
        var (platform, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var p = platform;
        await platform.PostAsync("/v1/platform/tenants/{tenantId}/lifecycle-transitions", new { action = "suspend", expectedState = "trial", reasonCode = "non_payment" },
            $"/v1/platform/tenants/{b.TenantId}/lifecycle-transitions", PlatformTestData.Idem());
        Assert.Equal("TENANT_NOT_OPERATIONAL", Reason(await ChildrenAsync(guardian), "Bilal"));
    }

    [Fact]
    public async Task Guardians_only_see_their_own_children()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        var classId = await SchoolTestData.ClassAsync(school);
        var mine = TestData.NewPhone();
        var theirs = TestData.NewPhone();
        await SchoolTestData.StudentAsync(school, classId, "Mine", mine);
        await SchoolTestData.StudentAsync(school, classId, "Theirs", theirs);

        var (guardian, _) = await TestData.GuardianSignInAsync(factory, mine);
        using var g = guardian;
        var names = (await ChildrenAsync(guardian)).GetProperty("items").EnumerateArray().Select(c => c.GetProperty("firstName").GetString()).ToList();
        Assert.Equal(["Mine"], names);
    }

    [Fact]
    public async Task Profile_terms_and_device()
    {
        var phone = TestData.NewPhone();
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, phone, "Old Name");
        var (guardian, _) = await TestData.GuardianSignInAsync(factory, phone);
        using var g = guardian;

        var patched = await guardian.SendAsync(HttpMethod.Patch, "/v1/me/profile", null, new { fullName = "  New Name ", locale = "ar" }, null);
        Assert.Equal("New Name", patched["fullName"].GetString());
        Assert.Equal("ar", patched["locale"].GetString());
        Assert.Equal("VALIDATION_FAILED", (await guardian.SendAsync(HttpMethod.Patch, "/v1/me/profile", null, new { fullName = " " }, null)).Code);

        Assert.True((await guardian.GetAsync("/v1/me/profile"))["termsAcceptanceRequired"].GetBoolean());
        Assert.Equal("VALIDATION_FAILED", (await guardian.PostAsync("/v1/me/terms-acceptance", new { termsVersion = "1999-01" })).Code);
        Assert.Equal(204, (await guardian.PostAsync("/v1/me/terms-acceptance", new { termsVersion = "2026-08" })).Status);
        Assert.False((await guardian.GetAsync("/v1/me/profile"))["termsAcceptanceRequired"].GetBoolean());

        var device = await guardian.GetAsync("/v1/me/device");
        Assert.True(device["isActiveDevice"].GetBoolean());
        Assert.Equal("Pixel 9", device["currentDevice"].GetProperty("model").GetString());
    }

    [Fact]
    public async Task Notifications_and_push_tokens_are_per_user()
    {
        var phone = TestData.NewPhone();
        var other = TestData.NewPhone();
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, phone);
        await TestData.PendingGuardianAsync(factory, TestData.Greenfield, other);
        var (guardian, verify) = await TestData.GuardianSignInAsync(factory, phone);
        var (someoneElse, otherVerify) = await TestData.GuardianSignInAsync(factory, other);
        using var g = guardian;
        using var o = someoneElse;
        var userId = verify["me"].GetProperty("userId").GetGuid();
        var otherId = otherVerify["me"].GetProperty("userId").GetGuid();

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var notifier = scope.ServiceProvider.GetRequiredService<INotifier>();
            await notifier.NotifyAsync(userId, TestData.Greenfield, "pickup_status", "Leo is on the way", "Sent out to the gate", new Dictionary<string, string> { ["pickupRequestId"] = Guid.NewGuid().ToString() }, CancellationToken.None);
            await notifier.NotifyAsync(userId, TestData.Greenfield, "pickup_reminder", "Please confirm pickup", "Tap to confirm", null, CancellationToken.None);
            await notifier.NotifyAsync(otherId, TestData.Greenfield, "pickup_status", "Not yours", "Other family", null, CancellationToken.None);
        }

        var page = await guardian.GetAsync("/v1/me/notifications");
        Assert.Equal(2, page["items"].GetArrayLength());
        Assert.Equal(2, page["unreadCount"].GetInt32());
        Assert.DoesNotContain(page["items"].EnumerateArray(), n => n.GetProperty("title").GetString() == "Not yours");

        Assert.Equal("VALIDATION_FAILED", (await guardian.PostAsync("/v1/me/notifications/read", new { })).Code);
        var first = page["items"][0].GetProperty("id").GetGuid();
        Assert.Equal(204, (await guardian.PostAsync("/v1/me/notifications/read", new { ids = new[] { first } })).Status);
        Assert.Equal(1, (await guardian.GetAsync("/v1/me/notifications", "/v1/me/notifications?unreadOnly=true"))["items"].GetArrayLength());
        // Marking someone else's notification is a no-op for them.
        var theirs = (await someoneElse.GetAsync("/v1/me/notifications"))["items"][0].GetProperty("id").GetGuid();
        await guardian.PostAsync("/v1/me/notifications/read", new { ids = new[] { theirs } });
        Assert.Equal(1, (await someoneElse.GetAsync("/v1/me/notifications"))["unreadCount"].GetInt32());
        Assert.Equal(204, (await guardian.PostAsync("/v1/me/notifications/read", new { all = true })).Status);
        Assert.Equal(0, (await guardian.GetAsync("/v1/me/notifications"))["unreadCount"].GetInt32());

        Assert.Equal("VALIDATION_FAILED", (await guardian.PostAsync("/v1/me/push-tokens", new { provider = "carrier-pigeon", token = "x" })).Code);
        Assert.Equal(204, (await guardian.PostAsync("/v1/me/push-tokens", new { provider = "fcm", token = "token-1" })).Status);
        Assert.Equal(204, (await guardian.PostAsync("/v1/me/push-tokens", new { provider = "fcm", token = "token-2" })).Status); // replaces
        Assert.Equal(1L, Convert.ToInt64(await factory.ScalarAsAppAsync($"SELECT count(*) FROM notifications.push_token WHERE user_id = '{userId}'"), System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(204, (await guardian.SendAsync(HttpMethod.Delete, "/v1/me/push-tokens/current", null, null, null)).Status);
        Assert.Equal(0L, Convert.ToInt64(await factory.ScalarAsAppAsync($"SELECT count(*) FROM notifications.push_token WHERE user_id = '{userId}'"), System.Globalization.CultureInfo.InvariantCulture));
    }
}
