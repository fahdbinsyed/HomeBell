using System.Net.Http.Headers;
using System.Text;
using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

public sealed class SchoolTests(ApiFactory factory)
{
    [Fact]
    public async Task Staff_invitations_roles_and_the_last_admin_rule()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        var me = await school.Admin.GetAsync("/v1/auth/me");
        Assert.Equal("school.admin", me["memberships"][0].GetProperty("role").GetString());

        Assert.Equal("STAFF_INVITATION_INVALID", (await factory.Api().PostAsync("/v1/auth/staff/invitations/preview", new { token = "nope" })).Code);
        Assert.Equal("CONFLICT", (await school.Admin.PostAsync("/v1/t/{tenantId}/staff-invitations", new { email = school.AdminEmail, fullName = "Me", role = "school.admin" }, school.P("/staff-invitations"))).Code);

        // An existing HomeBell user (admin@greenfield) joins with their existing password.
        await school.Admin.PostAsync("/v1/t/{tenantId}/staff-invitations", new { email = "admin@greenfield.test", fullName = "Adam Admin", role = "school.reporting" }, school.P("/staff-invitations"));
        var token = SchoolTestData.InvitationToken(factory, "admin@greenfield.test");
        using var anon = factory.Api();
        var preview = await anon.PostAsync("/v1/auth/staff/invitations/preview", new { token });
        Assert.True(preview["accountExists"].GetBoolean());
        Assert.Equal("INVALID_CREDENTIALS", (await anon.PostAsync("/v1/auth/staff/invitations/accept", new { token, password = "wrong-password-xx" })).Code);
        Assert.Equal(200, (await anon.PostAsync("/v1/auth/staff/invitations/accept", new { token, password = TestData.DemoPassword })).Status);
        Assert.Equal("STAFF_INVITATION_INVALID", (await anon.PostAsync("/v1/auth/staff/invitations/accept", new { token, password = TestData.DemoPassword })).Code);

        var staff = await school.Admin.GetAsync("/v1/t/{tenantId}/staff", school.P("/staff"));
        var members = staff["members"].EnumerateArray().ToList();
        Assert.Equal(2, members.Count);
        var adminMember = members.Single(m => m.GetProperty("role").GetString() == "school.admin");
        var path = school.P($"/staff/{adminMember.GetProperty("membershipId").GetGuid()}");

        Assert.Equal("CONFLICT", (await school.Admin.SendAsync(HttpMethod.Patch, "/v1/t/{tenantId}/staff/{membershipId}", path, new { role = "school.dispatcher" }, null)).Code);
        Assert.Equal("CONFLICT", (await school.Admin.PostAsync("/v1/t/{tenantId}/staff/{membershipId}/deactivate", null, path + "/deactivate")).Code);

        using var frontDesk = await SchoolTestData.StaffAsync(factory, school, "school.front_desk");
        Assert.Equal("FORBIDDEN", (await frontDesk.GetAsync("/v1/t/{tenantId}/staff", school.P("/staff"))).Code);
        school.Admin.Dispose();
    }

    [Fact]
    public async Task Classes_sections_and_students()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        var classId = await SchoolTestData.ClassAsync(school);
        Assert.Equal("CONFLICT", (await school.Admin.PostAsync("/v1/t/{tenantId}/classes", new { name = "grade 1" }, school.P("/classes"))).Code);
        var section = await school.Admin.PostAsync("/v1/t/{tenantId}/classes/{classId}/sections", new { name = "1A" }, school.P($"/classes/{classId}/sections"));
        Assert.Equal(201, section.Status);

        var phone = TestData.NewPhone();
        var s = await SchoolTestData.StudentAsync(school, classId, "Ava", phone, "S-1");
        Assert.Equal("Grade 1", s.GetProperty("className").GetString());
        Assert.Equal("pending_activation", s.GetProperty("primaryGuardian").GetProperty("state").GetString());
        Assert.Equal(1, s.GetProperty("guardianCount").GetInt32());

        var dup = await school.Admin.PostAsync("/v1/t/{tenantId}/students", new { externalRef = "S-1", firstName = "X", lastName = "Y", classId, primaryGuardian = new { fullName = "P", phone = TestData.NewPhone(), relationship = "father" } }, school.P("/students"));
        Assert.Equal("CONFLICT", dup.Code);

        var studentId = s.GetProperty("id").GetGuid();
        var sp = school.P($"/students/{studentId}");
        using var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", school.Admin.BearerToken);
        var etag = (await http.GetAsync(sp)).Headers.ETag!.Tag;
        var patched = await school.Admin.SendAsync(HttpMethod.Patch, "/v1/t/{tenantId}/students/{studentId}", sp,
            new { sectionId = section["id"].GetGuid(), restrictionsNote = "Only mother may collect", dismissalEligibility = "hold" }, new Dictionary<string, string> { ["If-Match"] = etag });
        Assert.Equal("1A", patched["sectionName"].GetString());
        Assert.Equal("Only mother may collect", patched["restrictionsNote"].GetString());
        Assert.Equal("PRECONDITION_FAILED", (await school.Admin.SendAsync(HttpMethod.Patch, "/v1/t/{tenantId}/students/{studentId}", sp, new { notes = "x" }, new Dictionary<string, string> { ["If-Match"] = etag })).Code);

        // Dispatchers read students but never see restriction notes or guardian phone numbers.
        using var dispatcher = await SchoolTestData.StaffAsync(factory, school, "school.dispatcher");
        var asDispatcher = await dispatcher.GetAsync("/v1/t/{tenantId}/students/{studentId}", sp);
        Assert.Equal(System.Text.Json.JsonValueKind.Null, asDispatcher["restrictionsNote"].ValueKind);
        Assert.Equal("FORBIDDEN", (await dispatcher.PostAsync("/v1/t/{tenantId}/students/{studentId}/deactivate", new { }, sp + "/deactivate")).Code);

        var list = await school.Admin.GetAsync("/v1/t/{tenantId}/students", school.P($"/students?q=ava&classId={classId}"));
        Assert.Equal(1, list["items"].GetArrayLength());
        Assert.Equal("CLASS_NOT_EMPTY", (await school.Admin.SendAsync(HttpMethod.Delete, "/v1/t/{tenantId}/classes/{classId}", school.P($"/classes/{classId}"), null, null)).Code);

        Assert.Equal("inactive", (await school.Admin.PostAsync("/v1/t/{tenantId}/students/{studentId}/deactivate", new { note = "Moved" }, sp + "/deactivate"))["status"].GetString());
        Assert.Equal("active", (await school.Admin.PostAsync("/v1/t/{tenantId}/students/{studentId}/reactivate", new { }, sp + "/reactivate"))["status"].GetString());

        var guardians = await school.Admin.GetAsync("/v1/t/{tenantId}/students/{studentId}/guardians", sp + "/guardians");
        Assert.True(guardians["items"][0].GetProperty("isPrimary").GetBoolean());
    }

    [Fact]
    public async Task Student_limit_comes_from_entitlements()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        var (platform, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var p = platform;
        await platform.PostAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides", new { kind = "limit", key = "students.max", value = 1, reasonCode = "pilot_program", note = "Tiny pilot" },
            $"/v1/platform/tenants/{school.TenantId}/entitlement-overrides");
        var classId = await SchoolTestData.ClassAsync(school);
        await SchoolTestData.StudentAsync(school, classId, "One", TestData.NewPhone());
        var second = await school.Admin.PostAsync("/v1/t/{tenantId}/students", new { firstName = "Two", lastName = "T", classId, primaryGuardian = new { fullName = "P", phone = TestData.NewPhone(), relationship = "father" } }, school.P("/students"));
        Assert.Equal("LIMIT_EXCEEDED", second.Code);
        Assert.Equal("students.max", second["meta"].GetProperty("limit").GetString());
    }

    [Fact]
    public async Task Guardian_management()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        var classId = await SchoolTestData.ClassAsync(school);
        var phone = TestData.NewPhone();
        var s1 = await SchoolTestData.StudentAsync(school, classId, "Kid1", phone);
        var s2 = await SchoolTestData.StudentAsync(school, classId, "Kid2", TestData.NewPhone());
        var gId = s1.GetProperty("primaryGuardian").GetProperty("guardianId").GetGuid();
        var gp = school.P($"/guardians/{gId}");

        var g = await school.Admin.GetAsync("/v1/t/{tenantId}/guardians/{guardianId}", gp);
        Assert.Equal(phone, g["phone"].GetString());

        Assert.Equal("GUARDIAN_PHONE_IN_USE", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians", new { fullName = "Dup", phone, links = new[] { new { studentId = s2.GetProperty("id").GetGuid(), relationship = "aunt_uncle", isPrimary = false } } }, school.P("/guardians"))).Code);
        Assert.Equal("PRIMARY_GUARDIAN_EXISTS", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/links", new { studentId = s2.GetProperty("id").GetGuid(), relationship = "mother", isPrimary = true }, gp + "/links")).Code);
        var linked = await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/links", new { studentId = s2.GetProperty("id").GetGuid(), relationship = "aunt_uncle", isPrimary = false }, gp + "/links");
        Assert.Equal(2, linked["students"].GetArrayLength());
        Assert.Equal("CONFLICT", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/links", new { studentId = s2.GetProperty("id").GetGuid(), relationship = "aunt_uncle", isPrimary = false }, gp + "/links")).Code);
        Assert.Equal("PRIMARY_GUARDIAN_REQUIRED", (await school.Admin.SendAsync(HttpMethod.Delete, "/v1/t/{tenantId}/guardians/{guardianId}/links/{studentId}", gp + $"/links/{s1.GetProperty("id").GetGuid()}", null, null)).Code);
        Assert.Equal(204, (await school.Admin.SendAsync(HttpMethod.Delete, "/v1/t/{tenantId}/guardians/{guardianId}/links/{studentId}", gp + $"/links/{s2.GetProperty("id").GetGuid()}", null, null)).Status);

        Assert.Equal("VALIDATION_FAILED", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/block", new { reason = "x" }, gp + "/block")).Code);
        Assert.Equal("blocked", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/block", new { reason = "Court order" }, gp + "/block"))["state"].GetString());
        Assert.Equal("CONFLICT", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/block", new { reason = "Again please" }, gp + "/block")).Code);
        Assert.Equal("pending_activation", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/unblock", new { reason = "Order lifted" }, gp + "/unblock"))["state"].GetString());

        Assert.Equal(202, (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/send-welcome", null, gp + "/send-welcome")).Status);
        Assert.Equal("RATE_LIMITED", (await school.Admin.PostAsync("/v1/t/{tenantId}/guardians/{guardianId}/send-welcome", null, gp + "/send-welcome")).Code);
        Assert.Contains(factory.Otp.Sent, m => m.Phone == phone && m.Purpose == "welcome");

        var devices = await school.Admin.GetAsync("/v1/t/{tenantId}/guardians/{guardianId}/devices", gp + "/devices");
        Assert.Equal(System.Text.Json.JsonValueKind.Null, devices["activeDevice"].ValueKind);

        using var dispatcher = await SchoolTestData.StaffAsync(factory, school, "school.dispatcher");
        var asDispatcher = await dispatcher.GetAsync("/v1/t/{tenantId}/guardians", school.P("/guardians"));
        Assert.All(asDispatcher["items"].EnumerateArray(), x => Assert.Equal(System.Text.Json.JsonValueKind.Null, x.GetProperty("phone").ValueKind));
    }

    [Fact]
    public async Task Imported_guardians_activate_at_first_sign_in()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        var classId = await SchoolTestData.ClassAsync(school);
        var phone = TestData.NewPhone();
        await SchoolTestData.StudentAsync(school, classId, "Zoe", phone);

        var (guardian, verify) = await TestData.GuardianSignInAsync(factory, phone);
        using var g = guardian;
        Assert.Equal("authenticated", verify["outcome"].GetString());
        Assert.Single(verify["activatedProfiles"].EnumerateArray());
        var list = await school.Admin.GetAsync("/v1/t/{tenantId}/guardians", school.P($"/guardians?state=active&q={Uri.EscapeDataString(phone)}"));
        Assert.Equal(1, list["items"].GetArrayLength());
        Assert.Equal("Pixel 9", list["items"][0].GetProperty("activeDevice").GetProperty("model").GetString());
    }

    [Fact]
    public async Task Settings_with_validation_etag_and_entitlement_gate()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        using var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", school.Admin.BearerToken);
        var get = await http.GetAsync(school.P("/settings"));
        var etag = get.Headers.ETag!.Tag;
        var settings = System.Text.Json.Nodes.JsonNode.Parse(await get.Content.ReadAsStringAsync())!;
        Assert.Equal(5, settings["dismissal"]!["windows"]!.AsArray().Count);

        settings["dismissal"]!["timeouts"]!["sentOutReminderMinutes"] = 99;
        Assert.Equal("VALIDATION_FAILED", (await school.Admin.SendAsync(HttpMethod.Put, "/v1/t/{tenantId}/settings", school.P("/settings"), settings, null)).Code);

        settings["dismissal"]!["timeouts"]!["sentOutReminderMinutes"] = 7;
        settings["branding"]!["primaryColor"] = "#1F6FEB";
        var saved = await school.Admin.SendAsync(HttpMethod.Put, "/v1/t/{tenantId}/settings", school.P("/settings"), settings, new Dictionary<string, string> { ["If-Match"] = etag });
        Assert.Equal(7, saved["dismissal"].GetProperty("timeouts").GetProperty("sentOutReminderMinutes").GetInt32());
        Assert.Equal("PRECONDITION_FAILED", (await school.Admin.SendAsync(HttpMethod.Put, "/v1/t/{tenantId}/settings", school.P("/settings"), settings, new Dictionary<string, string> { ["If-Match"] = etag })).Code);

        var (platform, _) = await PlatformTestData.SuperAdminAsync(factory);
        using var p = platform;
        await platform.PostAsync("/v1/platform/tenants/{tenantId}/entitlement-overrides", new { kind = "feature", key = "dismissal.location_rule", value = false, reasonCode = "other", note = "Not in this pilot" },
            $"/v1/platform/tenants/{school.TenantId}/entitlement-overrides");
        settings["locationRule"]!["enabled"] = true;
        settings["locationRule"]!["center"] = new System.Text.Json.Nodes.JsonObject { ["lat"] = 40.7, ["lng"] = -74.0 };
        var gated = await school.Admin.SendAsync(HttpMethod.Put, "/v1/t/{tenantId}/settings", school.P("/settings"), settings, null);
        Assert.Equal("FEATURE_NOT_ENTITLED", gated.Code);

        var overview = await school.Admin.GetAsync("/v1/t/{tenantId}/overview", school.P("/overview"));
        Assert.Equal(0, overview["students"].GetProperty("active").GetInt32());
        var sub = await school.Admin.GetAsync("/v1/t/{tenantId}/subscription", school.P("/subscription"));
        Assert.Equal("Standard", sub["planName"].GetString());
        Assert.Equal("trial", sub["state"].GetString());
        var ents = await school.Admin.GetAsync("/v1/t/{tenantId}/entitlements", school.P("/entitlements"));
        Assert.Equal("override", ents["features"].EnumerateArray().Single(f => f.GetProperty("key").GetString() == "dismissal.location_rule").GetProperty("source").GetString());
    }

    [Fact]
    public async Task Csv_import_validates_then_commits()
    {
        var school = await SchoolTestData.NewSchoolAsync(factory);
        using var _ = school.Admin;
        await SchoolTestData.ClassAsync(school, "Grade 3");
        using var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", school.Admin.BearerToken);
        var template = await http.GetAsync(school.P("/imports/template"));
        Assert.Equal("text/csv", template.Content.Headers.ContentType?.MediaType);

        var p1 = TestData.NewPhone();
        var csv = "student_external_ref,student_first_name,student_last_name,class,section,guardian_full_name,guardian_phone,guardian_relationship\n" +
                  $"IMP-1,Ana,Gomez,Grade 3,3A,Lucia Gomez,{p1},mother\n" +
                  $"IMP-2,Ben,Gomez,grade 3,,Lucia Gomez,{p1},MOTHER\n" +
                  "IMP-3,Cy,Bad,Grade 9,,Nobody,5551234,cousin\n";
        using var form = new MultipartFormDataContent { { new StringContent("students_with_guardians"), "type" } };
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        file.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        form.Add(file, "file", "students.csv");
        var upload = await http.PostAsync(school.P("/imports"), form);
        var uploadBody = await upload.Content.ReadAsStringAsync();
        ContractValidator.AssertResponse("POST", "/v1/t/{tenantId}/imports", (int)upload.StatusCode, uploadBody, upload.Content.Headers.ContentType?.MediaType);
        var job = System.Text.Json.JsonDocument.Parse(uploadBody).RootElement;
        var summary = job.GetProperty("summary");
        Assert.Equal(3, summary.GetProperty("totalRows").GetInt32());
        Assert.Equal(1, summary.GetProperty("errorRows").GetInt32());
        Assert.Equal(2, summary.GetProperty("studentsToCreate").GetInt32());
        Assert.Equal(1, summary.GetProperty("guardiansToCreate").GetInt32());
        var jobPath = school.P($"/imports/{job.GetProperty("id").GetGuid()}");

        var errors = await school.Admin.GetAsync("/v1/t/{tenantId}/imports/{importId}/rows", jobPath + "/rows?status=error");
        var messages = errors["items"][0].GetProperty("messages").EnumerateArray().Select(m => m.GetProperty("field").GetString()).ToList();
        Assert.Contains("class", messages);
        Assert.Contains("guardian_phone", messages);
        Assert.Contains("guardian_relationship", messages);

        Assert.Equal("IMPORT_HAS_ERRORS", (await school.Admin.PostAsync("/v1/t/{tenantId}/imports/{importId}/commit", new { }, jobPath + "/commit", PlatformTestData.Idem())).Code);
        var committed = await school.Admin.PostAsync("/v1/t/{tenantId}/imports/{importId}/commit", new { skipErrorRows = true }, jobPath + "/commit", PlatformTestData.Idem());
        Assert.Equal(202, committed.Status);
        Assert.Equal("completed", committed["status"].GetString());
        Assert.Equal("IMPORT_ALREADY_COMMITTED", (await school.Admin.PostAsync("/v1/t/{tenantId}/imports/{importId}/commit", new { skipErrorRows = true }, jobPath + "/commit", PlatformTestData.Idem())).Code);

        var students = await school.Admin.GetAsync("/v1/t/{tenantId}/students", school.P("/students?q=gomez"));
        Assert.Equal(2, students["items"].GetArrayLength());
        Assert.All(students["items"].EnumerateArray(), s => Assert.Equal("Lucia Gomez", s.GetProperty("primaryGuardian").GetProperty("fullName").GetString()));
        var classes = await school.Admin.GetAsync("/v1/t/{tenantId}/classes", school.P("/classes"));
        Assert.Contains(classes["items"][0].GetProperty("sections").EnumerateArray(), s => s.GetProperty("name").GetString() == "3A");

        using var json = new StringContent("{}", Encoding.UTF8, "application/json");
        Assert.Equal(415, (int)(await http.PostAsync(school.P("/imports"), json)).StatusCode);
    }
}
