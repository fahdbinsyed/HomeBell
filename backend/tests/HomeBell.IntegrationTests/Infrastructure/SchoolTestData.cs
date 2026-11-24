using System.Text.Json;

namespace HomeBell.IntegrationTests.Infrastructure;

public sealed record TestSchool(Guid TenantId, ApiClient Admin, string AdminEmail)
{
    public string P(string path) => $"/v1/t/{TenantId}{path}";
}

public static class SchoolTestData
{
    /// <summary>
    /// A fresh school, created the way production does it: platform creates a trial tenant on the Standard plan and
    /// invites the principal; the principal accepts the emailed invitation (sets a password) and is signed in.
    /// </summary>
    public static async Task<TestSchool> NewSchoolAsync(ApiFactory factory)
    {
        var (platform, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var _ = platform;
        var slug = PlatformTestData.Slug();
        var t = await platform.PostAsync("/v1/platform/tenants",
            PlatformTestData.NewTenant(slug, "trial", DateTimeOffset.UtcNow.AddDays(60), invite: true, planVersionId: HomeBell.Api.DevSeeder.StandardV1),
            headers: PlatformTestData.Idem());
        Assert.Equal(201, t.Status);
        var email = $"principal@{slug}.test";
        var admin = await AcceptInvitationAsync(factory, email, "Pat Principal", "school-admin-password-1");
        return new TestSchool(t["id"].GetGuid(), admin, email);
    }

    /// <summary>Accepts the most recent invitation emailed to <paramref name="email"/>; returns a signed-in client.</summary>
    public static async Task<ApiClient> AcceptInvitationAsync(ApiFactory factory, string email, string fullName, string password)
    {
        var token = InvitationToken(factory, email);
        var api = factory.Api();
        var accepted = await api.PostAsync("/v1/auth/staff/invitations/accept", new { token, fullName, password });
        Assert.Equal(200, accepted.Status);
        Assert.Equal("authenticated", accepted["status"].GetString());
        api.BearerToken = accepted["tokens"].GetProperty("accessToken").GetString();
        return api;
    }

    public static string InvitationToken(ApiFactory factory, string email)
    {
        var mail = factory.Email.Sent.Last(m => m.To == email && m.Body.Contains("/invite/staff?token=", StringComparison.Ordinal));
        return Uri.UnescapeDataString(mail.Body.Split("token=")[1].Split('\n')[0].Trim());
    }

    /// <summary>Invites a staff member with <paramref name="role"/> and signs them in.</summary>
    public static async Task<ApiClient> StaffAsync(ApiFactory factory, TestSchool school, string role)
    {
        var email = $"{role.Replace("school.", "", StringComparison.Ordinal).Replace('_', '-')}-{Guid.NewGuid():N}"[..24] + "@staff.test";
        var inv = await school.Admin.PostAsync("/v1/t/{tenantId}/staff-invitations", new { email, fullName = $"Staff {role}", role }, school.P("/staff-invitations"));
        Assert.Equal(201, inv.Status);
        return await AcceptInvitationAsync(factory, email, $"Staff {role}", "staff-password-123");
    }

    public static async Task<Guid> ClassAsync(TestSchool school, string name = "Grade 1")
    {
        var c = await school.Admin.PostAsync("/v1/t/{tenantId}/classes", new { name }, school.P("/classes"));
        Assert.Equal(201, c.Status);
        return c["id"].GetGuid();
    }

    public static async Task<JsonElement> StudentAsync(TestSchool school, Guid classId, string first, string phone, string? externalRef = null)
    {
        var s = await school.Admin.PostAsync("/v1/t/{tenantId}/students", new
        {
            externalRef,
            firstName = first,
            lastName = "Test",
            classId,
            primaryGuardian = new { fullName = $"Parent of {first}", phone, relationship = "mother" },
        }, school.P("/students"));
        Assert.Equal(201, s.Status);
        return s.Body;
    }
}
