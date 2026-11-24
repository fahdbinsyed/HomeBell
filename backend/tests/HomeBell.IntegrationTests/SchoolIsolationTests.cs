using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

/// <summary>
/// Tenant-isolation suite for the school plane (02-multitenancy §4.6): a caller of school A addressing
/// school B — by path or by a resource id from B — gets 404 and never sees B's rows.
/// </summary>
public sealed class SchoolIsolationTests(ApiFactory factory)
{
    private static readonly string[] ReadEndpoints =
    [
        "/overview", "/entitlements", "/subscription", "/settings", "/classes", "/students", "/guardians", "/staff", "/audit-logs", "/imports/template",
    ];

    [Fact]
    public async Task Every_school_endpoint_hides_other_tenants()
    {
        var a = await SchoolTestData.NewSchoolAsync(factory);
        var b = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = a.Admin;
        using var __ = b.Admin;
        var bClass = await SchoolTestData.ClassAsync(b);
        var bStudent = await SchoolTestData.StudentAsync(b, bClass, "Secret", TestData.NewPhone(), "B-1");
        var bStudentId = bStudent.GetProperty("id").GetGuid();
        var bGuardianId = bStudent.GetProperty("primaryGuardian").GetProperty("guardianId").GetGuid();

        // A's admin on B's path → 404 for every endpoint (never 403: no tenant enumeration).
        foreach (var ep in ReadEndpoints)
        {
            var template = "/v1/t/{tenantId}" + ep;
            var r = await a.Admin.GetAsync(template, b.P(ep));
            Assert.True(r.Code == "NOT_FOUND", $"{ep} on a foreign tenant returned {r.Status} {r.Code}");
        }

        Assert.Equal("NOT_FOUND", (await a.Admin.PostAsync("/v1/t/{tenantId}/classes", new { name = "Intruder" }, b.P("/classes"))).Code);

        // B's resource ids through A's own path → 404 (RLS + query filters, not just the path check).
        Assert.Equal("NOT_FOUND", (await a.Admin.GetAsync("/v1/t/{tenantId}/students/{studentId}", a.P($"/students/{bStudentId}"))).Code);
        Assert.Equal("NOT_FOUND", (await a.Admin.GetAsync("/v1/t/{tenantId}/guardians/{guardianId}", a.P($"/guardians/{bGuardianId}"))).Code);
        Assert.Equal("NOT_FOUND", (await a.Admin.PostAsync("/v1/t/{tenantId}/students/{studentId}/deactivate", new { }, a.P($"/students/{bStudentId}/deactivate"))).Code);
        var aClass = await SchoolTestData.ClassAsync(a);
        var crossLink = await a.Admin.PostAsync("/v1/t/{tenantId}/guardians", new { fullName = "Cross", phone = TestData.NewPhone(), links = new[] { new { studentId = bStudentId, relationship = "mother", isPrimary = false } } }, a.P("/guardians"));
        Assert.Equal("NOT_FOUND", crossLink.Code);

        // Lists never contain foreign rows.
        var aStudents = await a.Admin.GetAsync("/v1/t/{tenantId}/students", a.P("/students?q=Secret"));
        Assert.Equal(0, aStudents["items"].GetArrayLength());
        var aAudit = await a.Admin.GetAsync("/v1/t/{tenantId}/audit-logs", a.P("/audit-logs?limit=100"));
        Assert.All(aAudit["items"].EnumerateArray(), e => Assert.Equal(a.TenantId, e.GetProperty("tenantId").GetGuid()));
        Assert.NotEqual(Guid.Empty, aClass);
    }

    [Fact]
    public async Task Read_only_and_blocked_tenants_reject_writes()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        var (platform, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var p = platform;
        await platform.PostAsync("/v1/platform/tenants/{tenantId}/lifecycle-transitions", new { action = "suspend", expectedState = "trial", reasonCode = "non_payment" },
            $"/v1/platform/tenants/{school.TenantId}/lifecycle-transitions", PlatformTestData.Idem());

        Assert.Equal(200, (await school.Admin.GetAsync("/v1/t/{tenantId}/students", school.P("/students"))).Status); // reads still work
        var write = await school.Admin.PostAsync("/v1/t/{tenantId}/classes", new { name = "Grade 4" }, school.P("/classes"));
        Assert.Equal("TENANT_READ_ONLY", write.Code);
        Assert.Equal("read_only", write["meta"].GetProperty("operationalMode").GetString());

        var tenant = await platform.GetAsync("/v1/platform/tenants/{tenantId}", $"/v1/platform/tenants/{school.TenantId}");
        await platform.PostAsync("/v1/platform/tenants/{tenantId}/lifecycle-transitions",
            new { action = "deactivate", expectedState = "suspended", reasonCode = "school_request", confirmTenantName = tenant["name"].GetString() },
            $"/v1/platform/tenants/{school.TenantId}/lifecycle-transitions", PlatformTestData.Idem());
        Assert.Equal("TENANT_NOT_OPERATIONAL", (await school.Admin.PostAsync("/v1/t/{tenantId}/classes", new { name = "Grade 5" }, school.P("/classes"))).Code);
    }

    [Fact]
    public async Task Support_sessions_read_one_tenant_and_never_write()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        var other = await SchoolTestData.NewSchoolAsync(factory);
        using var __ = other.Admin;
        var (analyst, _) = await PlatformTestData.SignInAsync(factory, "platform.support_analyst");
        using var a = analyst;
        var created = await analyst.PostAsync("/v1/platform/support-sessions", new { tenantId = school.TenantId, reason = "Checking an import problem", durationMinutes = 10 });
        using var support = factory.Api();
        support.BearerToken = created["tokens"].GetProperty("accessToken").GetString();

        Assert.Equal(200, (await support.GetAsync("/v1/t/{tenantId}/students", school.P("/students"))).Status);
        Assert.Equal("SCOPE_INSUFFICIENT", (await support.PostAsync("/v1/t/{tenantId}/classes", new { name = "Nope" }, school.P("/classes"))).Code);
        Assert.Equal("FORBIDDEN", (await support.GetAsync("/v1/t/{tenantId}/staff", school.P("/staff"))).Code); // not in the read-only bundle
        Assert.Equal("NOT_FOUND", (await support.GetAsync("/v1/t/{tenantId}/students", other.P("/students"))).Code);
    }
}
