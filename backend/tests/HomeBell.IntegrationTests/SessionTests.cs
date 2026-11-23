using HomeBell.IntegrationTests.Infrastructure;

namespace HomeBell.IntegrationTests;

public sealed class SessionTests(ApiFactory factory)
{
    private async Task<ApiResponse> AdminLoginAsync(ApiClient api) =>
        await api.PostAsync("/v1/auth/staff/login", new { email = "admin@greenfield.test", password = TestData.DemoPassword });

    [Fact]
    public async Task Refresh_rotates_and_reuse_revokes_the_whole_session()
    {
        using var api = factory.Api();
        var login = await AdminLoginAsync(api);
        var first = login["tokens"].GetProperty("refreshToken").GetString();

        var rotated = await api.PostAsync("/v1/auth/refresh", new { refreshToken = first });
        Assert.Equal(200, rotated.Status);
        var second = rotated["refreshToken"].GetString();
        Assert.NotEqual(first, second);

        var reuse = await api.PostAsync("/v1/auth/refresh", new { refreshToken = first });
        Assert.Equal("REFRESH_TOKEN_REUSED", reuse.Code);

        // The legitimate holder is signed out too, including access tokens already issued.
        Assert.Equal("SESSION_REVOKED", (await api.PostAsync("/v1/auth/refresh", new { refreshToken = second })).Code);
        api.BearerToken = rotated["accessToken"].GetString();
        Assert.Equal("SESSION_REVOKED", (await api.GetAsync("/v1/auth/me")).Code);
    }

    [Fact]
    public async Task Unknown_refresh_token_is_invalid()
    {
        using var api = factory.Api();
        Assert.Equal("REFRESH_TOKEN_INVALID", (await api.PostAsync("/v1/auth/refresh", new { refreshToken = "not-a-real-token" })).Code);
    }

    [Fact]
    public async Task Logout_revokes_the_access_token_immediately()
    {
        using var api = factory.Api();
        var login = await AdminLoginAsync(api);
        api.BearerToken = login["tokens"].GetProperty("accessToken").GetString();

        var me = await api.GetAsync("/v1/auth/me");
        Assert.Equal(200, me.Status);
        Assert.Equal("Adam Admin", me["fullName"].GetString());

        Assert.Equal(204, (await api.PostAsync("/v1/auth/logout")).Status);
        Assert.Equal("SESSION_REVOKED", (await api.GetAsync("/v1/auth/me")).Code);
    }

    [Fact]
    public async Task Missing_or_tampered_tokens_are_unauthenticated()
    {
        using var api = factory.Api();
        Assert.Equal("UNAUTHENTICATED", (await api.GetAsync("/v1/auth/me")).Code);

        var login = await AdminLoginAsync(api);
        var token = login["tokens"].GetProperty("accessToken").GetString()!;
        api.BearerToken = token[..^4] + (token.EndsWith("AAAA", StringComparison.Ordinal) ? "BBBB" : "AAAA");
        Assert.Equal("UNAUTHENTICATED", (await api.GetAsync("/v1/auth/me")).Code);
    }

    [Fact]
    public async Task Expired_access_token_reports_token_expired()
    {
        using var api = factory.Api();
        try
        {
            factory.Clock.Advance(TimeSpan.FromMinutes(-30)); // issue a token that expired 20 minutes ago
            var login = await AdminLoginAsync(api);
            api.BearerToken = login["tokens"].GetProperty("accessToken").GetString();
        }
        finally
        {
            factory.Clock.Reset();
        }

        Assert.Equal("TOKEN_EXPIRED", (await api.GetAsync("/v1/auth/me")).Code);
    }
}
