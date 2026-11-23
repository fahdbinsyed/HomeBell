using HomeBell.Api;
using HomeBell.BuildingBlocks.Application;
using HomeBell.BuildingBlocks.Domain.Contract;
using HomeBell.Modules.Guardians.Domain;
using HomeBell.Modules.Guardians.Infrastructure;
using HomeBell.Modules.Identity.Contracts;
using Microsoft.Extensions.DependencyInjection;
using OtpNet;

namespace HomeBell.IntegrationTests.Infrastructure;

public static class TestData
{
    public static readonly Guid Greenfield = DevSeeder.Greenfield;
    public static readonly Guid Riverside = DevSeeder.Riverside;
    public const string DemoPassword = "demo1234";

    private static int _phoneCounter = 200;

    /// <summary>A fresh +1 555 01x xxxx test number so per-phone OTP limits never collide between tests.</summary>
    public static string NewPhone() => $"+1555{Interlocked.Increment(ref _phoneCounter):D7}";

    public static object Device(string platform = DevicePlatform.Android) =>
        new { platform, model = platform == DevicePlatform.Ios ? "iPhone 17" : "Pixel 9", osVersion = "16", appVersion = "1.0.0" };

    /// <summary>Creates a pending primary guardian profile (as a school import would — ADR-0007).</summary>
    public static async Task<Guid> PendingGuardianAsync(ApiFactory factory, Guid tenantId, string phone, string name = "Test Guardian", string kind = GuardianKind.Primary)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var userId = await sp.GetRequiredService<IUserAccounts>().EnsureByPhoneAsync(phone, name, CancellationToken.None);
        using var _ = sp.GetRequiredService<ITenantContext>().Scope(tenantId);
        var db = sp.GetRequiredService<GuardiansDbContext>();
        var g = new Guardian(Guid.CreateVersion7(), tenantId, userId, kind, name, phone, factory.Clock.UtcNow);
        db.Guardians.Add(g);
        await db.SaveChangesAsync();
        return g.Id;
    }

    public static string OwnerTotp(ApiFactory factory, int stepOffset = 0) =>
        new Totp(Base32Encoding.ToBytes(DevSeeder.OwnerTotpSecret)).ComputeTotp(factory.Clock.UtcNow.UtcDateTime.AddSeconds(30 * stepOffset));

    /// <summary>Full guardian sign-in on a device; returns the client with the bearer token set.</summary>
    public static async Task<(ApiClient Client, ApiResponse Verify)> GuardianSignInAsync(ApiFactory factory, string phone, Guid? device = null)
    {
        var api = factory.Api();
        api.DeviceId = device ?? Guid.NewGuid();
        var ch = await api.PostAsync("/v1/auth/otp/send", new { phone, purpose = "login" });
        Assert.Equal(202, ch.Status);
        var verify = await api.PostAsync("/v1/auth/otp/verify", new { challengeId = ch["challengeId"].GetGuid(), code = "000000", device = Device() });
        if (verify.Status == 200 && verify["outcome"].GetString() == "authenticated")
        {
            api.BearerToken = verify["tokens"].GetProperty("accessToken").GetString();
        }

        return (api, verify);
    }
}
