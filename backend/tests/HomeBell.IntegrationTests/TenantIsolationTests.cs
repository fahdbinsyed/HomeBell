using Microsoft.Extensions.DependencyInjection;
using System.Globalization;
using HomeBell.BuildingBlocks.Application;
using HomeBell.IntegrationTests.Infrastructure;
using HomeBell.Modules.Guardians.Domain;
using HomeBell.Modules.Guardians.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace HomeBell.IntegrationTests;

/// <summary>Defense in depth (02-multitenancy §4): PostgreSQL RLS, EF query filters, the write guard, tenant access.</summary>
public sealed class TenantIsolationTests(ApiFactory factory)
{
    private static long Count(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

    [Fact]
    public async Task App_role_is_restricted_and_rls_is_forced()
    {
        Assert.Equal(false, await factory.ScalarAsAppAsync("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
        foreach (var table in new[] { "guardians.guardian", "schools.tenant_membership", "audit.audit_log" })
        {
            Assert.Equal(true, await factory.ScalarAsAppAsync($"SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = '{table}'::regclass"));
        }
    }

    [Fact]
    public async Task Rls_hides_rows_outside_the_session_tenant()
    {
        var gf = TestData.Greenfield.ToString();
        var rv = TestData.Riverside.ToString();
        Assert.Equal(0, Count(await factory.ScalarAsAppAsync("SELECT count(*) FROM guardians.guardian")));
        var inGf = Count(await factory.ScalarAsAppAsync("SELECT count(*) FROM guardians.guardian", gf));
        var inRv = Count(await factory.ScalarAsAppAsync("SELECT count(*) FROM guardians.guardian", rv));
        var all = Count(await factory.ScalarAsAppAsync("SELECT count(*) FROM guardians.guardian", crossTenant: true));
        Assert.True(inGf > 0 && inRv > 0);
        Assert.Equal(0, Count(await factory.ScalarAsAppAsync($"SELECT count(*) FROM guardians.guardian WHERE tenant_id <> '{gf}'", gf)));
        Assert.True(all >= inGf + inRv);
    }

    [Fact]
    public async Task Rls_rejects_writing_a_row_into_another_tenant()
    {
        var sql = $"""
            INSERT INTO guardians.guardian (id, tenant_id, user_id, kind, full_name, phone, state, created_at)
            VALUES ('{Guid.CreateVersion7()}', '{TestData.Riverside}', '{Guid.CreateVersion7()}', 'primary', 'Intruder', '+15550000000', 'active', now())
            """;
        var ex = await Assert.ThrowsAsync<PostgresException>(() => factory.ScalarAsAppAsync(sql, TestData.Greenfield.ToString()));
        Assert.Equal("42501", ex.SqlState); // new row violates row-level security policy
    }

    [Fact]
    public async Task Ef_queries_are_filtered_to_the_request_tenant()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var tenant = scope.ServiceProvider.GetRequiredService<ITenantContext>();
        var db = scope.ServiceProvider.GetRequiredService<GuardiansDbContext>();

        Assert.Empty(await db.Guardians.ToListAsync()); // unresolved tenant → nothing
        tenant.SetTenant(TestData.Greenfield);
        var rows = await db.Guardians.ToListAsync();
        Assert.NotEmpty(rows);
        Assert.All(rows, g => Assert.Equal(TestData.Greenfield, g.TenantId));
    }

    [Fact]
    public async Task Ef_write_guard_blocks_cross_tenant_changes_before_sql()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<ITenantContext>().SetTenant(TestData.Greenfield);
        var db = scope.ServiceProvider.GetRequiredService<GuardiansDbContext>();
        db.Guardians.Add(new Guardian(Guid.CreateVersion7(), TestData.Riverside, Guid.CreateVersion7(), "primary", "X", "+15550000001", DateTimeOffset.UtcNow));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        Assert.Contains("Cross-tenant write blocked", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Staff_access_resolver_returns_nothing_for_foreign_or_unknown_tenants()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<ITenantAccessResolver>();
        var dispatcherId = (Guid)(await factory.ScalarAsAppAsync("SELECT id FROM identity.user_account WHERE email = 'dispatch@greenfield.test'"))!;
        var actor = new FakeActor(dispatcherId, "staff");

        var gf = await resolver.ResolveAsync(actor, TestData.Greenfield, CancellationToken.None);
        Assert.NotNull(gf);
        Assert.Equal("school.dispatcher", gf!.Role);
        Assert.Contains("school.queue.dispatch", gf.Permissions);
        Assert.DoesNotContain("school.staff.manage", gf.Permissions);

        Assert.Null(await resolver.ResolveAsync(actor, TestData.Riverside, CancellationToken.None)); // no membership there
        Assert.Null(await resolver.ResolveAsync(actor, Guid.NewGuid(), CancellationToken.None)); // unknown tenant
    }

    [Fact]
    public async Task Audit_log_is_append_only_for_the_app_role()
    {
        var update = await Assert.ThrowsAsync<PostgresException>(() => factory.ScalarAsAppAsync("UPDATE audit.audit_log SET outcome = 'success'", crossTenant: true));
        Assert.Equal("42501", update.SqlState);
        var delete = await Assert.ThrowsAsync<PostgresException>(() => factory.ScalarAsAppAsync("DELETE FROM audit.audit_log", crossTenant: true));
        Assert.Equal("42501", delete.SqlState);
    }

    [Fact]
    public async Task Audit_rows_mask_phone_numbers()
    {
        using var api = factory.Api();
        api.DeviceId = Guid.NewGuid();
        var phone = TestData.NewPhone();
        await api.PostAsync("/v1/auth/otp/send", new { phone, purpose = "login" });
        var masked = HomeBell.BuildingBlocks.Application.Phone.Mask(phone);
        Assert.True(Count(await factory.ScalarAsAppAsync($"SELECT count(*) FROM audit.audit_log WHERE action = 'otp.sent' AND target_id = '{masked}'", crossTenant: true)) >= 1);
        // The full number appears nowhere in the audit log (target or data).
        Assert.Equal(0, Count(await factory.ScalarAsAppAsync(
            $"SELECT count(*) FROM audit.audit_log WHERE coalesce(target_id, '') LIKE '%{phone[1..]}%' OR data::text LIKE '%{phone[1..]}%'", crossTenant: true)));
    }

    private sealed class FakeActor(Guid id, string kind) : ICurrentActor
    {
        public bool IsAuthenticated => true;

        public ActorType Type => ActorType.User;

        public Guid? Id => id;

        public string DisplayName => "Test";

        public Guid? SessionId => Guid.NewGuid();

        public Guid? DeviceId => null;

        public string? SessionKind => kind;

        public string? Scope => "full";

        public IReadOnlyCollection<string> PlatformRoles => [];

        public Guid? SupportTenantId => null;

        public string? IpAddress => null;

        public string? UserAgent => null;

        public string RequestId => "test";
    }
}
